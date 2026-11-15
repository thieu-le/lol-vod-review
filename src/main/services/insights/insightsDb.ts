import type { MatchResult } from '@shared/types';
import type {
  LiveActivePlayer,
  LiveEvent,
  LiveGameStats,
  LivePlayer,
} from '../riot/liveClient';

// Read-only queries against Insights Capture's own SQLite database
// (%APPDATA%\Insights Capture\db.sqlite3). Insights is the recorder now; its
// database tells us, per video file:
//   - what the file is (full recording vs highlight/clip) and when it started
//   - the final Riot Live Client payload for the game (all events, players,
//     game clock) — the same data our own poller captures
//   - each update's position on the VIDEO clock, which gives an exact
//     game-time → video-time offset
//
// The schema is Insights' private format (kysely migrations, v3.9.x when this
// was written) and can change under us, so every read is defensive: a missing
// table/column or unparseable value yields null and the caller falls back to
// our own Live Client capture. We never write to this database.
//
// Written against a minimal statement interface so the same code runs on
// better-sqlite3 in the app and on node:sqlite in tests.

export interface SqlStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface SqlDb {
  prepare(sql: string): SqlStatement;
}

// Overwolf's game class id for League of Legends.
export const LOL_GAME_CLASS_ID = 5426;

export interface InsightsVideo {
  uuid: string;
  type: string; // 'recording' = full match; also 'highlight', 'clip', 'merged', ...
  createdAtMs: number; // recording start, epoch ms
  durationSeconds: number;
  filePath: string;
}

export interface InsightsLeagueData {
  events: LiveEvent[];
  activePlayer: LiveActivePlayer | null;
  allPlayers: LivePlayer[];
  gameData: LiveGameStats | null;
  // vodSeconds = gameSeconds + vodOffsetSeconds. Null when Insights recorded no
  // game clock for this video.
  vodOffsetSeconds: number | null;
  riotGameId: number | null;
  queueId: number | null;
  champion: string | null;
  result: MatchResult | undefined;
  // Manual bookmarks, in seconds into the video.
  bookmarkSeconds: number[];
}

const REQUIRED_COLUMNS: Record<string, string[]> = {
  video: ['uuid', 'type', 'created_at', 'duration', 'file_path'],
  video_game_info_update: ['video_uuid', 'timestamp', 'feature', 'key', 'value'],
  video_game_event: ['video_uuid', 'timestamp', 'feature', 'key', 'value'],
};

// True when the tables/columns we read exist. Checked once per open so a
// schema change degrades to "Insights data unavailable" instead of throwing on
// every ingest.
export function hasExpectedSchema(db: SqlDb): boolean {
  try {
    for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
      const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
      const have = new Set(rows.map((r) => r.name));
      if (!cols.every((c) => have.has(c))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Insights' configured save folder (Settings → Capture), if it recorded one.
export function readVideoLibraryLocation(db: SqlDb): string | null {
  try {
    const row = db
      .prepare(
        `SELECT value FROM setting_internal
         WHERE path = 'videoLibrary.location' AND id_type IS NULL LIMIT 1`
      )
      .get() as { value: unknown } | undefined;
    const v = parseJson<string>(row?.value);
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function findVideoByPath(db: SqlDb, filePath: string): InsightsVideo | null {
  const row = db
    .prepare(
      `SELECT uuid, type, created_at, duration, file_path FROM video
       WHERE lower(file_path) = lower(?) LIMIT 1`
    )
    .get(filePath) as
    | { uuid: string; type: string; created_at: number; duration: number; file_path: string }
    | undefined;
  if (!row) return null;
  return {
    uuid: row.uuid,
    type: row.type,
    // Insights stores epoch seconds (fractional).
    createdAtMs: Math.round(row.created_at * 1000),
    durationSeconds: row.duration,
    filePath: row.file_path,
  };
}

interface UpdateRow {
  timestamp: number;
  feature: string;
  key: string | null;
  value: unknown;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Offset from matching the player's own K/D/A events. Pairs the last N of each
// kind from both sides (the video can start mid-game, so earlier Riot events may
// have no video counterpart). Needs at least 3 pairs; null otherwise.
function kdaOffset(
  db: SqlDb,
  videoUuid: string,
  events: LiveEvent[],
  ap: LiveActivePlayer | null
): number | null {
  if (!ap) return null;
  const ids = new Set(
    [ap.riotId, ap.riotIdGameName, ap.summonerName].filter(
      (v): v is string => typeof v === 'string' && v.length > 0
    )
  );
  if (ids.size === 0) return null;
  const riot: Record<string, number[]> = { kill: [], death: [], assist: [] };
  for (const e of events) {
    if (e.EventName !== 'ChampionKill' || typeof e.EventTime !== 'number') continue;
    if (typeof e.KillerName === 'string' && ids.has(e.KillerName)) riot.kill.push(e.EventTime);
    else if (typeof e.VictimName === 'string' && ids.has(e.VictimName)) riot.death.push(e.EventTime);
    else if (Array.isArray(e.Assisters) && e.Assisters.some((a) => ids.has(a as string)))
      riot.assist.push(e.EventTime);
  }
  const video: Record<string, number[]> = { kill: [], death: [], assist: [] };
  let rows: { timestamp: number; feature: string; value: unknown }[] = [];
  try {
    rows = db
      .prepare(
        `SELECT timestamp, feature, value FROM video_game_event
         WHERE video_uuid = ? AND feature IN ('kill', 'death', 'assist')
         ORDER BY timestamp ASC`
      )
      .all(videoUuid) as typeof rows;
  } catch {
    return null;
  }
  for (const r of rows) {
    if (r.feature === 'kill') {
      // Multikill announcements ("double_kill", ...) repeat a kill; skip them.
      const v = parseJson<{ label?: string }>(r.value);
      if (v?.label && v.label !== 'kill') continue;
    }
    video[r.feature]?.push(r.timestamp);
  }
  const diffs: number[] = [];
  for (const k of ['kill', 'death', 'assist']) {
    const a = riot[k];
    const b = video[k];
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) diffs.push(b[b.length - n + i] - a[a.length - n + i]);
  }
  if (diffs.length < 3) return null;
  return median(diffs);
}

export function readLeagueData(db: SqlDb, videoUuid: string): InsightsLeagueData {
  const updates = db
    .prepare(
      `SELECT timestamp, feature, key, value FROM video_game_info_update
       WHERE video_uuid = ? ORDER BY timestamp ASC`
    )
    .all(videoUuid) as UpdateRow[];

  // Latest value per (feature, key), plus every game_data sample for the offset.
  const latest = new Map<string, UpdateRow>();
  const clockOffsets: number[] = [];
  const eventsById = new Map<number, LiveEvent>();
  for (const u of updates) {
    latest.set(`${u.feature}/${u.key ?? ''}`, u);
    if (u.feature === 'live_client_data' && u.key === 'game_data') {
      const gd = parseJson<LiveGameStats>(u.value);
      // A sample stamped before the video started is bogus (seen in the wild).
      if (gd && typeof gd.gameTime === 'number' && typeof u.timestamp === 'number' && u.timestamp >= 0) {
        clockOffsets.push(u.timestamp - gd.gameTime);
      }
    }
    if (u.feature === 'live_client_data' && u.key === 'events') {
      // Union across snapshots by EventID (Insights usually stores one final
      // snapshot, but be robust to several).
      const ev = parseJson<{ Events?: LiveEvent[] }>(u.value);
      for (const e of ev?.Events ?? []) {
        if (typeof e?.EventID === 'number') eventsById.set(e.EventID, e);
      }
    }
  }
  const val = <T>(feature: string, key: string): T | null =>
    parseJson<T>(latest.get(`${feature}/${key}`)?.value);

  const events = [...eventsById.values()].sort((a, b) => a.EventID - b.EventID);

  // Result: GameEnd if Insights caught it, else the end-of-game announcer cue.
  let result: MatchResult | undefined;
  const end = events.find((e) => e.EventName === 'GameEnd');
  if (end?.Result === 'Win') result = 'Win';
  else if (end?.Result === 'Lose') result = 'Lose';
  if (!result) {
    const cue = db
      .prepare(
        `SELECT key FROM video_game_event
         WHERE video_uuid = ? AND feature = 'announcer' AND key IN ('victory', 'defeat')
         ORDER BY timestamp DESC LIMIT 1`
      )
      .get(videoUuid) as { key: string } | undefined;
    if (cue?.key === 'victory') result = 'Win';
    else if (cue?.key === 'defeat') result = 'Lose';
  }

  let bookmarkSeconds: number[] = [];
  try {
    bookmarkSeconds = (
      db
        .prepare('SELECT timestamp FROM video_bookmark WHERE video_uuid = ? ORDER BY timestamp')
        .all(videoUuid) as { timestamp: number }[]
    ).map((r) => r.timestamp);
  } catch {
    // Bookmarks are optional; older/newer schemas may not have the table.
  }

  const activePlayer = val<LiveActivePlayer>('live_client_data', 'active_player');
  // Preferred anchor: pair the player's kills/deaths/assists as Riot timed them
  // (game clock) with Insights' own markers for the same moments (video clock).
  // Checked against 190 real recordings: agrees with the game_data sample to
  // ~0.5s where both exist, and still works when the sample is missing/bogus.
  const offset = kdaOffset(db, videoUuid, events, activePlayer) ?? median(clockOffsets);
  const riotGameId = val<number | string>('matchState', 'matchId');
  const queueId = val<number | string>('matchState', 'queueId');
  const champion = val<string>('summoner_info', 'champion');
  const toInt = (v: number | string | null): number | null => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  };

  return {
    events,
    activePlayer,
    allPlayers: val<LivePlayer[]>('live_client_data', 'all_players') ?? [],
    gameData: val<LiveGameStats>('live_client_data', 'game_data'),
    vodOffsetSeconds: offset === null ? null : Math.round(offset * 1000) / 1000,
    riotGameId: toInt(riotGameId),
    queueId: toInt(queueId),
    champion: typeof champion === 'string' && champion.length > 0 ? champion : null,
    result,
    bookmarkSeconds,
  };
}

// Full-match League recordings Insights writes: "League of Legends - 2026-10-30T00-03-52.mp4"
// (local time), with " (1)" appended on name collisions.
const LOL_RECORDING_RE =
  /^League of Legends - (\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?: \(\d+\))?\.mp4$/i;

// ---------------------------------------------------------------------------
// VALORANT
//
// Valorant has no Live Client API, so for Valorant matches Insights' recorded
// data is the only source. Everything below is timed on the VIDEO clock
// (seconds into the file), so these matches use a VOD offset of 0.

export const VALORANT_GAME_CLASS_ID = 21640;

// The player's own kills / deaths / assists. Insights bumps a running counter
// (kill.kills, death.deaths, kill.assists) at the moment each happens.
export type ValorantPersonalKind = 'kill' | 'death' | 'assist';

export interface ValorantRound {
  round: number;
  atSeconds: number;
  side: string | null; // 'attack' | 'defense' at round start, when known
}

export interface ValorantData {
  agent: string | null; // display name, e.g. "Neon"
  map: string | null; // display name, e.g. "Sunset"
  mode: string | null; // e.g. "Competitive", "Unrated", "Swiftplay"
  ranked: boolean | null;
  matchId: string | null;
  result: MatchResult | undefined;
  kills: number;
  deaths: number;
  assists: number;
  roundsWon: number | null;
  roundsLost: number | null;
  rounds: ValorantRound[];
  personal: { kind: ValorantPersonalKind; atSeconds: number }[];
  bookmarkSeconds: number[];
}

// Riot's internal agent codenames as Insights/Overwolf report them.
const AGENT_NAMES: Record<string, string> = {
  Breach: 'Breach', BountyHunter: 'Fade', Clay: 'Raze', Deadeye: 'Chamber', Grenadier: 'KAY/O',
  Guide: 'Gekko', Gumshoe: 'Cypher', Hunter: 'Sova', Killjoy: 'Killjoy', Mage: 'Harbor',
  Pandemic: 'Viper', Phoenix: 'Phoenix', Rift: 'Astra', Sage: 'Sage', Sarge: 'Brimstone',
  Sequoia: 'Deadlock', Smonk: 'Clove', Sprinter: 'Neon', Stealth: 'Yoru', Thorne: 'Sage',
  Vampire: 'Reyna', Wraith: 'Omen', Wushu: 'Jett', AggroBot: 'Gekko', Cable: 'Tejo',
  Nox: 'Vyse', Terra: 'Waylay', Iso: 'Iso', Pine: 'Iso',
};
const MAP_NAMES: Record<string, string> = {
  Ascent: 'Ascent', Bonsai: 'Split', Canyon: 'Fracture', Duality: 'Bind', Foxtrot: 'Breeze',
  Infinity: 'Abyss', Jam: 'Lotus', Juliett: 'Sunset', Pitt: 'Pearl', Port: 'Icebox',
  Triad: 'Haven', Rook: 'Corrode', Range: 'The Range', HURM_Alley: 'District',
  HURM_Bowl: 'Kasbah', HURM_Yard: 'Piazza', HURM_Helix: 'Drift', HURM_HighTide: 'Glitch',
};
const MODE_NAMES: Record<string, string> = {
  bomb: 'Standard', swift: 'Swiftplay', spikerush: 'Spike Rush', deathmatch: 'Deathmatch',
  hurm: 'Team Deathmatch', escalation: 'Escalation', replication: 'Replication',
};

export function valorantAgentName(raw: string | null): string | null {
  if (!raw) return null;
  // "Sprinter_PC_C", "Smonk_PostDeath" → "Sprinter", "Smonk"
  const code = raw.split('_')[0];
  return AGENT_NAMES[code] ?? code;
}
export function valorantMapName(raw: string | null): string | null {
  if (!raw) return null;
  return MAP_NAMES[raw] ?? raw;
}

export function readValorantData(db: SqlDb, videoUuid: string): ValorantData {
  const updates = db
    .prepare(
      `SELECT timestamp, feature, key, value FROM video_game_info_update
       WHERE video_uuid = ? AND feature IN ('me', 'match_info', 'kill', 'death')
         AND key NOT LIKE 'scoreboard_%' AND key NOT LIKE 'roster_%'
       ORDER BY timestamp ASC`
    )
    .all(videoUuid) as UpdateRow[];

  // Last non-null value per key (Insights clears every key to null at the end).
  const last = new Map<string, unknown>();
  const rounds: ValorantRound[] = [];
  const personal: { kind: ValorantPersonalKind; atSeconds: number }[] = [];
  let side: string | null = null;
  const prevCount: Record<string, number> = {};
  for (const u of updates) {
    const v = parseJson<unknown>(u.value);
    if (v === null || v === undefined) continue;
    const k = `${u.feature}/${u.key ?? ''}`;
    last.set(k, v);
    if (k === 'match_info/team' && typeof v === 'string') side = v;
    if (k === 'match_info/round_number') {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0 && !rounds.some((r) => r.round === n)) {
        rounds.push({ round: n, atSeconds: Math.max(0, u.timestamp), side });
      }
    }
    const counter: Record<string, ValorantPersonalKind> = {
      'kill/kills': 'kill',
      'kill/assists': 'assist',
      'death/deaths': 'death',
    };
    const kind = counter[k];
    if (kind) {
      const n = Number(v);
      if (Number.isFinite(n) && n > (prevCount[k] ?? 0)) {
        // One marker per increment (a quick double kill can land in one update).
        for (let i = prevCount[k] ?? 0; i < n; i++) personal.push({ kind, atSeconds: u.timestamp });
        prevCount[k] = n;
      }
    }
  }

  const str = (key: string): string | null => {
    const v = last.get(key);
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  const num = (key: string): number => {
    const n = Number(last.get(key));
    return Number.isFinite(n) ? n : 0;
  };

  const outcome = str('match_info/match_outcome');
  const result: MatchResult | undefined =
    outcome === 'victory' ? 'Win' : outcome === 'defeat' ? 'Lose' : undefined;

  const gm = last.get('match_info/game_mode') as
    | { mode?: string; custom?: boolean; ranked?: string | number | boolean }
    | undefined;
  const ranked =
    gm && gm.ranked !== undefined ? gm.ranked === true || String(gm.ranked) === '1' : null;
  let mode: string | null = null;
  if (gm?.mode) {
    const base = MODE_NAMES[gm.mode] ?? gm.mode;
    mode = gm.custom ? `Custom ${base}` : gm.mode === 'bomb' ? (ranked ? 'Competitive' : 'Unrated') : base;
  }
  const score = last.get('match_info/score') as { won?: number; lost?: number } | undefined;

  let bookmarkSeconds: number[] = [];
  try {
    bookmarkSeconds = (
      db
        .prepare('SELECT timestamp FROM video_bookmark WHERE video_uuid = ? ORDER BY timestamp')
        .all(videoUuid) as { timestamp: number }[]
    ).map((r) => r.timestamp);
  } catch {
    // optional
  }

  return {
    agent: valorantAgentName(str('me/agent')),
    map: valorantMapName(str('match_info/map')),
    mode,
    ranked,
    matchId: str('match_info/match_id'),
    result,
    kills: num('kill/kills'),
    deaths: num('death/deaths'),
    assists: num('kill/assists'),
    roundsWon: typeof score?.won === 'number' ? score.won : null,
    roundsLost: typeof score?.lost === 'number' ? score.lost : null,
    rounds: rounds.sort((a, b) => a.round - b.round),
    personal: personal.sort((a, b) => a.atSeconds - b.atSeconds),
    bookmarkSeconds,
  };
}

// "VALORANT - 2026-10-18T16-10-40.mp4"
const VALORANT_RECORDING_RE =
  /^VALORANT - (\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?: \(\d+\))?\.mp4$/i;

export type RecordingGame = 'lol' | 'valorant';

// Which game a full-match Insights recording is for, and its start time
// (epoch ms, local time), from the file name. Null for anything else
// (highlights, clips, other games).
export function parseRecordingName(
  fileName: string
): { game: RecordingGame; startedAt: number } | null {
  for (const [game, re] of [
    ['lol', LOL_RECORDING_RE],
    ['valorant', VALORANT_RECORDING_RE],
  ] as const) {
    const m = re.exec(fileName);
    if (!m) continue;
    const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
    const t = new Date(y, mo - 1, d, h, mi, s).getTime();
    if (Number.isFinite(t)) return { game, startedAt: t };
  }
  return null;
}
