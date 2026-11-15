import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import type { InsightsStatus, Match, MatchResult } from '@shared/types';
import { config } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { toMessage } from '../../lib/errors';
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

interface PendingFile {
  size: number;
  mtimeMs: number;
  firstSeenAt: number;
}

export interface ResolvedPaths {
  videoDir: string;
  dbPath: string;
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
  private pending = new Map<string, PendingFile>();
  private status: InsightsStatus = {
    state: 'folder_missing',
    videoDir: '',
    dbAvailable: false,
    lastIngestAt: null,
    lastError: null,
  };
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
    this.pending.clear();
    if (this.timer) clearTimeout(this.timer);
    this.schedule(0);
  }

  resolvePaths(): ResolvedPaths {
    const s = settingsRepository().getInsights();
    const dbPath = s.dbPath || join(app.getPath('appData'), 'Insights Capture', 'db.sqlite3');
    let videoDir = s.videoDir;
    if (!videoDir) {
      videoDir =
        this.withDb(dbPath, (db) => readVideoLibraryLocation(db)) ??
        join(app.getPath('videos'), 'Insights');
    }
    return { videoDir, dbPath };
  }

  private schedule(delay: number = config.insights.scanIntervalMs): void {
    this.timer = setTimeout(() => void this.scan(), delay);
  }

  private setStatus(patch: Partial<InsightsStatus>): void {
    const next = { ...this.status, ...patch };
    const changed = JSON.stringify(next) !== JSON.stringify(this.status);
    this.status = next;
    if (changed) this.emit('status', this.getStatus());
  }

  // Opens Insights' database read-only for one unit of work and closes it again
  // straight away, so we never hold a lock that could stall Insights' writes.
  // Returns null when the DB is missing, locked, or not the schema we expect.
  private withDb<T>(dbPath: string, fn: (db: SqlDb) => T): T | null {
    if (!existsSync(dbPath)) return null;
    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 2000 });
      if (!hasExpectedSchema(db as unknown as SqlDb)) {
        logger.warn('Insights database schema not recognized; using Live Client data only');
        return null;
      }
      return fn(db as unknown as SqlDb);
    } catch (err) {
      logger.warn('Could not read Insights database', toMessage(err));
      return null;
    } finally {
      db?.close();
    }
  }

  private async scan(): Promise<void> {
    if (this.scanning) return this.schedule();
    this.scanning = true;
    try {
      const { videoDir, dbPath } = this.resolvePaths();
      const dbAvailable = this.withDb(dbPath, () => true) === true;

      let names: string[];
      try {
        names = readdirSync(videoDir);
      } catch {
        this.setStatus({ state: 'folder_missing', videoDir, dbAvailable });
        return;
      }
      this.setStatus({ state: 'watching', videoDir, dbAvailable });

      const recordings = names
        .map((name) => ({ name, parsed: parseRecordingName(name) }))
        .filter((r): r is { name: string; parsed: NonNullable<typeof r.parsed> } => !!r.parsed);

      const ingested = insightsIngestedRepository();

      // First run: everything already in the folder is history, not new work.
      // Mark it so enabling this doesn't upload a backlog of old games.
      if (!settingsRepository().getInsightsSeeded()) {
        for (const r of recordings) {
          const path = join(videoDir, r.name);
          if (!ingested.has(path)) ingested.record(path, 'seeded', null);
        }
        settingsRepository().setInsightsSeeded(true);
        logger.info(`Seeded ${recordings.length} existing recording(s); only new ones are ingested`);
        return;
      }

      for (const r of recordings) {
        const path = join(videoDir, r.name);
        if (ingested.has(path)) continue;
        if (!this.isReady(path, dbPath, dbAvailable)) continue;
        try {
          this.ingest(path, r.parsed.game, r.parsed.startedAt, dbPath);
        } catch (err) {
          // Leave it un-ingested so the next scan retries; surface the error.
          logger.error('Ingest failed', path, err);
          this.setStatus({ lastError: `${r.name}: ${toMessage(err)}` });
        }
      }
    } catch (err) {
      logger.error('Insights scan failed', err);
      this.setStatus({ lastError: toMessage(err) });
    } finally {
      this.scanning = false;
      this.schedule();
    }
  }

  // A recording is ready once Insights has finished writing it: size and mtime
  // stable for a quiet period AND Insights has registered it in its database
  // (it inserts the row, with duration, when the recording is finalized). If
  // the database isn't usable we fall back to a much longer quiet period.
  private isReady(path: string, dbPath: string, dbAvailable: boolean): boolean {
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
    if (now - st.mtimeMs < config.insights.quietMs) return false;
    if (st.size === 0) return false;

    const registered = dbAvailable
      ? this.withDb(dbPath, (db) => findVideoByPath(db, path) !== null) === true
      : false;
    if (registered) return true;
    return now - st.mtimeMs >= config.insights.noDbQuietMs && !this.isGameInProgress();
  }

  private ingest(path: string, game: RecordingGame, nameStartedAt: number, dbPath: string): void {
    const ingested = insightsIngestedRepository();
    const video = this.withDb(dbPath, (db) => findVideoByPath(db, path));

    if (video && video.type !== 'recording') {
      ingested.record(path, 'skipped', null, `Insights video type "${video.type}"`);
      return;
    }

    const match =
      game === 'lol'
        ? this.ingestLeague(path, video, nameStartedAt, dbPath)
        : this.ingestValorant(path, video, nameStartedAt, dbPath);
    if (!match) return; // skipped (recorded with a reason inside)

    ingested.record(path, 'ingested', match.id);
    this.setStatus({ lastIngestAt: Date.now(), lastError: null });
    logger.info(`Ingested ${game} recording`, path, '->', match.id);
    this.emit('ingested', match);
  }

  private ingestLeague(
    path: string,
    video: InsightsVideo | null,
    nameStartedAt: number,
    dbPath: string
  ): Match | null {
    const matches = matchRepository();
    const data = video ? this.withDb(dbPath, (db) => readLeagueData(db, video.uuid)) : null;

    if (
      settingsRepository().getRankedOnly() &&
      data?.queueId != null &&
      !LOL_RANKED_QUEUES.has(data.queueId)
    ) {
      insightsIngestedRepository().record(path, 'skipped', null, `Ranked-only: queue ${data.queueId}`);
      return null;
    }

    const startedAt = video?.createdAtMs ?? nameStartedAt;
    let match =
      matches.findVodlessNear(
        startedAt,
        config.insights.matchWindowBeforeMs,
        config.insights.matchWindowAfterMs
      ) ?? matches.create({ game: 'lol', recordingStartedAt: startedAt, vodStatus: 'recorded' });

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

  private ingestValorant(
    path: string,
    video: InsightsVideo | null,
    nameStartedAt: number,
    dbPath: string
  ): Match | null {
    const matches = matchRepository();
    const data = video ? this.withDb(dbPath, (db) => readValorantData(db, video.uuid)) : null;

    if (settingsRepository().getRankedOnly() && data?.ranked === false) {
      insightsIngestedRepository().record(path, 'skipped', null, 'Ranked-only: unrated');
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
