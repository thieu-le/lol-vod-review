import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import type { InsightsStatus, Match, MatchResult } from '@shared/types';
import { config } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { toMessage } from '../../lib/errors';
import { getDb } from '../database/db';
import { matchRepository } from '../database/repositories/matchRepository';
import { eventRepository } from '../database/repositories/eventRepository';
import { settingsRepository } from '../database/repositories/settingsRepository';
import { insightsIngestedRepository } from '../database/repositories/insightsIngestedRepository';
import {
  activePlayerIdentities,
  computeKda,
  parseEvents,
  type ParsedEvent,
} from '../riot/eventParser';
import { resolveActiveChampion } from '../riot/liveClient';
import {
  findVideoByPath,
  hasExpectedSchema,
  parseRecordingName,
  readLeagueData,
  readValorantData,
  readVideoLibraryLocation,
  type InsightsVideo,
  type RecordingGame,
  type SqlDb,
} from './insightsDb';

const logger = createLogger('insights');

// League queues that count as ranked (Solo/Duo, Flex) for ranked-only mode.
const LOL_RANKED_QUEUES = new Set([420, 440]);

// Identity used for Valorant personal events. Insights reports the player's own
// kills/deaths/assists as counters, not names, so we attribute them to this
// sentinel and store it as the match's player identity.
const VALORANT_SELF = 'You';

// Distinguishes "the database said no" (ok, value null) from "couldn't read the
// database" (not ok) — the latter must be retried, never recorded as final.
type DbResult<T> = { ok: true; value: T } | { ok: false };

// Recordings this recent at first-run seeding may still be in progress or just
// finished; leave them to be ingested normally instead of marking them seen.
const SEED_GRACE_MS = 15 * 60_000;
// How long a looked-up Insights save folder is trusted before re-reading it.
const LIBRARY_LOCATION_TTL_MS = 5 * 60_000;

interface PendingFile {
  size: number;
  mtimeMs: number;
  firstSeenAt: number;
}

// Watches Insights Capture's video folder and turns each finished full-match
// recording (League or Valorant) into a match row with an attached VOD, exact
// chapter timing and — when auto-upload is on — a queued YouTube upload.
//
// Insights does the recording; this never touches its files or its database
// beyond reading. Our own Live Client capture (recorderController) still runs
// during League games and is merged in here, so a League game is covered even
// when Insights recorded no game data for it.
//
// Emits 'status' (InsightsStatus) and 'ingested' (Match).
export class InsightsWatcher extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;
  private rescanRequested = false;
  private dbChecked = false;
  private pending = new Map<string, PendingFile>();
  private status: InsightsStatus = {
    state: 'folder_missing',
    videoDir: '',
    dbAvailable: false,
    lastIngestAt: null,
    lastError: null,
  };
  // Last save folder read from Insights' settings, so a transient DB read
  // failure never silently switches the watched folder.
  private libraryLocation: { path: string; at: number } | null = null;
  // Lets the recorder hold off ingestion while a League game is in progress.
  private isGameInProgress: () => boolean = () => false;

  start(opts: { isGameInProgress?: () => boolean } = {}): void {
    if (opts.isGameInProgress) this.isGameInProgress = opts.isGameInProgress;
    this.schedule(0);
    logger.info('Insights watcher started');
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  getStatus(): InsightsStatus {
    return { ...this.status };
  }

  // Re-resolve paths and scan right away (after a settings change, or on demand).
  scanNow(): void {
    // Keep `pending`: stability tracking must survive a rescan, or a file being
    // written would look new (and never "quiet") on every manual scan.
    if (this.scanning) {
      this.rescanRequested = true;
      return;
    }
    this.schedule(0);
  }

  // Resolves the folder to watch. With no override, it is Insights' own save
  // folder; if that can't be read right now we keep the last known one, and
  // only use the OS default when Insights' database doesn't exist at all.
  // Returns videoDir null when the folder is unknown for now (DB exists but is
  // unreadable and nothing is cached): the scan then waits instead of guessing.
  resolvePaths(): { videoDir: string | null; dbPath: string } {
    const s = settingsRepository().getInsights();
    const dbPath = s.dbPath || join(app.getPath('appData'), 'Insights Capture', 'db.sqlite3');
    if (s.videoDir) return { videoDir: s.videoDir, dbPath };

    const cached = this.libraryLocation;
    if (cached && Date.now() - cached.at < LIBRARY_LOCATION_TTL_MS) {
      return { videoDir: cached.path, dbPath };
    }
    if (!existsSync(dbPath)) return { videoDir: join(app.getPath('videos'), 'Insights'), dbPath };
    const read = this.tryDb(dbPath, (db) => readVideoLibraryLocation(db));
    if (read.ok) {
      const path = read.value ?? join(app.getPath('videos'), 'Insights');
      this.libraryLocation = { path, at: Date.now() };
      return { videoDir: path, dbPath };
    }
    return { videoDir: cached?.path ?? null, dbPath };
  }

  // Exactly one pending timer at a time, so a manual scanNow() during a scan
  // can't fork the loop into two.
  private schedule(delay: number = config.insights.scanIntervalMs): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.scan();
    }, delay);
  }

  private setStatus(patch: Partial<InsightsStatus>): void {
    const next = { ...this.status, ...patch };
    const changed = JSON.stringify(next) !== JSON.stringify(this.status);
    this.status = next;
    if (changed) this.emit('status', this.getStatus());
  }

  // Opens Insights' database read-only for one unit of work and closes it again
  // straight away. Insights uses a rollback journal, so while we hold the file
  // its commits wait on us: keep every read short, never hold the handle, and
  // use a short busy timeout (this blocks the main process while it waits) —
  // on contention we just retry on the next scan.
  private tryDb<T>(dbPath: string, fn: (db: SqlDb) => T): DbResult<T> {
    if (!existsSync(dbPath)) return { ok: false };
    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 150 });
      if (!hasExpectedSchema(db as unknown as SqlDb)) {
        logger.warn('Insights database schema not recognized; using Live Client data only');
        return { ok: false };
      }
      return { ok: true, value: fn(db as unknown as SqlDb) };
    } catch (err) {
      logger.warn('Could not read Insights database', toMessage(err));
      return { ok: false };
    } finally {
      db?.close();
    }
  }

  private dbUsable(dbPath: string): boolean {
    return this.tryDb(dbPath, () => true).ok;
  }

  private async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.rescanRequested = false;
    try {
      const { videoDir, dbPath } = this.resolvePaths();
      if (!videoDir) {
        this.setStatus({ state: 'folder_missing', videoDir: '', dbAvailable: false });
        return;
      }

      let names: string[];
      try {
        names = readdirSync(videoDir);
      } catch {
        this.setStatus({ state: 'folder_missing', videoDir });
        return;
      }

      const recordings = names
        .map((name) => ({ name, parsed: parseRecordingName(name) }))
        .filter((r): r is { name: string; parsed: NonNullable<typeof r.parsed> } => !!r.parsed);

      const ingested = insightsIngestedRepository();
      const settings = settingsRepository();

      // First time we see a folder: everything already in it is history, not
      // new work, so enabling this (or switching folders) never uploads a
      // backlog. Very recent files are left for normal ingestion.
      if (!settings.isInsightsFolderSeeded(videoDir)) {
        const cutoff = Date.now() - SEED_GRACE_MS;
        let seeded = 0;
        for (const r of recordings) {
          const path = join(videoDir, r.name);
          if (ingested.has(path)) continue;
          let mtimeMs = 0;
          try {
            mtimeMs = statSync(path).mtimeMs;
          } catch {
            continue;
          }
          if (mtimeMs >= cutoff) continue;
          ingested.record(path, 'seeded', null);
          seeded += 1;
        }
        settings.markInsightsFolderSeeded(videoDir);
        logger.info(`Seeded ${seeded} existing recording(s) in ${videoDir}; only new ones are ingested`);
      }

      const candidates = recordings
        .map((r) => ({ ...r, path: join(videoDir, r.name) }))
        .filter((r) => !ingested.has(r.path))
        .filter((r) => this.isQuiet(r.path));

      // Only touch Insights' database when there is something to look up, and
      // never during a live League game (Insights is writing to it constantly).
      const gameLive = this.isGameInProgress();
      let dbAvailable = this.status.dbAvailable;
      if (!gameLive && (candidates.length > 0 || !this.dbChecked)) {
        dbAvailable = this.dbUsable(dbPath);
        this.dbChecked = true;
      }
      this.setStatus({ state: 'watching', videoDir, dbAvailable });
      if (gameLive) return;

      for (const r of candidates) {
        try {
          if (!this.isRegistered(r.path, dbPath, dbAvailable)) continue;
          this.ingest(r.path, r.parsed.game, r.parsed.startedAt, dbPath, dbAvailable);
        } catch (err) {
          // Leave it un-ingested so the next scan retries; surface the error.
          logger.error('Ingest failed', r.path, err);
          this.setStatus({ lastError: `${r.name}: ${toMessage(err)}` });
        }
      }
    } catch (err) {
      logger.error('Insights scan failed', err);
      this.setStatus({ lastError: toMessage(err) });
    } finally {
      this.scanning = false;
      this.schedule(this.rescanRequested ? 0 : config.insights.scanIntervalMs);
    }
  }

  // Quiet = size and mtime unchanged since the previous scan and the file not
  // modified for a while. Necessary but not sufficient: see isRegistered.
  private isQuiet(path: string): boolean {
    let st;
    try {
      st = statSync(path);
    } catch {
      this.pending.delete(path);
      return false;
    }
    const now = Date.now();
    const prev = this.pending.get(path);
    if (!prev || prev.size !== st.size || prev.mtimeMs !== st.mtimeMs) {
      this.pending.set(path, { size: st.size, mtimeMs: st.mtimeMs, firstSeenAt: now });
      return false;
    }
    return st.size > 0 && now - st.mtimeMs >= config.insights.quietMs;
  }

  // Finished = Insights has a row for it with a real duration (set when the
  // recording is finalized). If the database can't be used, fall back to a long
  // quiet period instead — much longer when the database exists (probably just
  // busy), since importing then means importing without Insights' game data.
  private isRegistered(path: string, dbPath: string, dbAvailable: boolean): boolean {
    if (dbAvailable) {
      const r = this.tryDb(dbPath, (db) => findVideoByPath(db, path));
      if (!r.ok) return false; // contention: retry next scan
      if (r.value) return r.value.durationSeconds > 0;
    }
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      return false;
    }
    const wait = existsSync(dbPath) ? config.insights.unreadableDbQuietMs : config.insights.noDbQuietMs;
    return Date.now() - mtimeMs >= wait;
  }

  // Reads everything needed from Insights first, then applies it to our
  // database in ONE transaction together with the ingested-marker, so a crash
  // or error can never leave a half-imported match that a retry duplicates.
  // Any failed Insights read throws, so the file is retried next scan rather
  // than recorded with missing data.
  private ingest(
    path: string,
    game: RecordingGame,
    nameStartedAt: number,
    dbPath: string,
    dbAvailable: boolean
  ): void {
    const ingested = insightsIngestedRepository();
    const must = <T>(r: DbResult<T>): T => {
      if (!r.ok) throw new Error('Insights database busy or unreadable; will retry');
      return r.value;
    };

    const video = dbAvailable ? must(this.tryDb(dbPath, (db) => findVideoByPath(db, path))) : null;
    if (video && video.type !== 'recording') {
      ingested.record(path, 'skipped', null, `Insights video type "${video.type}"`);
      return;
    }
    // Same Insights recording already imported under another path (renamed/moved).
    const existing = video ? matchRepository().findByInsightsVideo(video.uuid) : null;
    if (existing) {
      ingested.record(path, 'skipped', existing.id, 'Already imported (same Insights video)');
      return;
    }

    let match: Match | null;
    if (game === 'lol') {
      const data = video ? must(this.tryDb(dbPath, (db) => readLeagueData(db, video.uuid))) : null;
      match = getDb().transaction(() => {
        const m = this.applyLeague(path, video, data, nameStartedAt);
        if (m) ingested.record(path, 'ingested', m.id);
        return m;
      })();
    } else {
      const data = video ? must(this.tryDb(dbPath, (db) => readValorantData(db, video.uuid))) : null;
      match = getDb().transaction(() => {
        const m = this.applyValorant(path, video, data, nameStartedAt);
        if (m) ingested.record(path, 'ingested', m.id);
        return m;
      })();
    }
    if (!match) return; // skipped (recorded with a reason inside)

    this.setStatus({ lastIngestAt: Date.now(), lastError: null });
    logger.info(`Ingested ${game} recording`, path, '->', match.id);
    this.emit('ingested', match);
  }

  private applyLeague(
    path: string,
    video: InsightsVideo | null,
    data: ReturnType<typeof readLeagueData> | null,
    nameStartedAt: number
  ): Match | null {
    const matches = matchRepository();
    const startedAt = video?.createdAtMs ?? nameStartedAt;
    let live = matches.findVodlessNear(
      startedAt,
      config.insights.matchWindowBeforeMs,
      config.insights.matchWindowAfterMs
    );
    // Don't merge two different games (e.g. a remake tracked live, then the
    // next game): event ids restart every game, so a wrong link would drop the
    // real game's events as "duplicates".
    if (live?.champion && data?.champion && live.champion !== data.champion) live = null;

    // Ranked-only: skip a known non-ranked queue. With no Insights queue info,
    // a live-tracked match means the recorder already let it through the
    // ranked gate; with neither, we can't tell, so skip rather than upload.
    if (settingsRepository().getRankedOnly()) {
      const queue = data?.queueId ?? null;
      if ((queue !== null && !LOL_RANKED_QUEUES.has(queue)) || (queue === null && !live)) {
        insightsIngestedRepository().record(
          path,
          'skipped',
          null,
          queue === null ? 'Ranked-only: queue unknown' : `Ranked-only: queue ${queue}`
        );
        return null;
      }
    }

    let match =
      live ?? matches.create({ game: 'lol', recordingStartedAt: startedAt, vodStatus: 'recorded' });

    if (data && data.events.length > 0) {
      // Same parser and EventID dedupe as the live poller, so events captured
      // live and by Insights merge without duplicates.
      eventRepository().appendEvents(match.id, parseEvents(data.events));
      const identities =
        match.playerIdentities.length > 0
          ? match.playerIdentities
          : activePlayerIdentities(data.activePlayer ?? undefined);
      matches.setPlayerIdentities(match.id, identities);
      if (identities.length > 0) {
        matches.updateKda(match.id, computeKda(eventRepository().listForMatch(match.id), identities));
      }
    }
    if (data) {
      matches.updateMeta(match.id, {
        champion:
          data.champion ??
          resolveActiveChampion({
            activePlayer: data.activePlayer ?? undefined,
            allPlayers: data.allPlayers,
          }),
        gameMode: data.gameData?.gameMode ?? null,
        mapName: data.gameData?.mapName ?? null,
        queueId: data.queueId,
        riotGameId: data.riotGameId,
      });
    }

    // Exact offset from Insights when it has one; otherwise derive it from our
    // own GameStart observation against the recording start.
    match = matches.get(match.id) ?? match;
    const offset =
      data?.vodOffsetSeconds ??
      (match.gameStartedAt !== null ? (match.gameStartedAt - startedAt) / 1000 : null);
    const durationSeconds = video ? Math.round(video.durationSeconds) : null;

    return matches.attachVod(match.id, {
      vodLocalPath: path,
      vodOffsetSeconds: offset,
      vodDurationSeconds: video?.durationSeconds ?? null,
      insightsVideoUuid: video?.uuid ?? null,
      endedAt: durationSeconds !== null ? startedAt + durationSeconds * 1000 : null,
      durationSeconds:
        data?.gameData?.gameTime !== undefined ? Math.round(data.gameData.gameTime) : durationSeconds,
      result: data?.result,
    });
  }

  private applyValorant(
    path: string,
    video: InsightsVideo | null,
    data: ReturnType<typeof readValorantData> | null,
    nameStartedAt: number
  ): Match | null {
    const matches = matchRepository();

    // Ranked-only: only a known competitive match passes.
    if (settingsRepository().getRankedOnly() && data?.ranked !== true) {
      insightsIngestedRepository().record(
        path,
        'skipped',
        null,
        data?.ranked === false ? 'Ranked-only: unrated' : 'Ranked-only: mode unknown'
      );
      return null;
    }

    const startedAt = video?.createdAtMs ?? nameStartedAt;
    const match = matches.create({
      game: 'valorant',
      recordingStartedAt: startedAt,
      vodStatus: 'recorded',
    });

    if (data) {
      matches.updateMeta(match.id, { champion: data.agent, mapName: data.map, gameMode: data.mode });
      matches.updateKda(match.id, { kills: data.kills, deaths: data.deaths, assists: data.assists });
      matches.setPlayerIdentities(match.id, [VALORANT_SELF]);
      eventRepository().appendEvents(match.id, valorantEvents(data));
    }

    const durationSeconds = video ? Math.round(video.durationSeconds) : null;
    const result: MatchResult | undefined = data?.result;
    return matches.attachVod(match.id, {
      vodLocalPath: path,
      vodOffsetSeconds: 0, // Valorant events are already on the video clock
      vodDurationSeconds: video?.durationSeconds ?? null,
      insightsVideoUuid: video?.uuid ?? null,
      endedAt: durationSeconds !== null ? startedAt + durationSeconds * 1000 : null,
      durationSeconds,
      result,
    });
  }
}

// Valorant rounds and the player's own K/D/A as match events. Kills/deaths/
// assists use the ChampionKill shape attributed to VALORANT_SELF so the
// existing timeline markers and KDA logic work unchanged. Event ids are
// synthetic but deterministic (rounds 1..n, then personal events from 10000),
// so a re-ingest dedupes.
function valorantEvents(data: ReturnType<typeof readValorantData>): ParsedEvent[] {
  const out: ParsedEvent[] = [];
  for (const r of data.rounds) {
    out.push({
      eventId: r.round,
      eventType: 'RoundStart',
      eventTimeSeconds: r.atSeconds,
      killerName: null,
      victimName: null,
      assisters: [],
      payload: {
        EventID: r.round,
        EventName: 'RoundStart',
        EventTime: r.atSeconds,
        Round: r.round,
        Side: r.side,
      },
    });
  }
  data.personal.forEach((p, i) => {
    const eventId = 10_000 + i;
    out.push({
      eventId,
      eventType: 'ChampionKill',
      eventTimeSeconds: p.atSeconds,
      killerName: p.kind === 'kill' ? VALORANT_SELF : null,
      victimName: p.kind === 'death' ? VALORANT_SELF : null,
      assisters: p.kind === 'assist' ? [VALORANT_SELF] : [],
      payload: { EventID: eventId, EventName: 'ChampionKill', EventTime: p.atSeconds, Kind: p.kind },
    });
  });
  return out;
}

export const insightsWatcher = new InsightsWatcher();
