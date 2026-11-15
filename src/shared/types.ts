// Domain types + enumerated business values.
// Enums are `as const` arrays; TS types are derived via typeof ARR[number].

export const VOD_STATUS = [
  'recording',
  'recorded',
  'uploading',
  'uploaded',
  'archived',
  'deleted',
  'failed',
] as const;
export type VodStatus = (typeof VOD_STATUS)[number];

// Games the app tracks. League is captured live (Riot Live Client) and from
// Insights; Valorant comes only from Insights Capture's recorded data.
export const GAME = ['lol', 'valorant'] as const;
export type Game = (typeof GAME)[number];

export const MATCH_RESULT = ['Win', 'Lose', 'Unknown'] as const;
export type MatchResult = (typeof MATCH_RESULT)[number];

// High-level state of the recorder pipeline, surfaced to the UI.
export const RECORDER_STATE = [
  'idle',
  'in_game',
  'post_game',
] as const;
export type RecorderState = (typeof RECORDER_STATE)[number];

// Health of the Insights Capture integration, surfaced to the UI.
//  - watching:       video folder found and being scanned
//  - folder_missing: the configured video folder doesn't exist / isn't readable
export const INSIGHTS_WATCH_STATE = ['watching', 'folder_missing'] as const;
export type InsightsWatchState = (typeof INSIGHTS_WATCH_STATE)[number];

// Local VOD retention after a successful upload. Default never deletes
// immediately — YouTube post-upload processing can still fail.
export const RETENTION_POLICY = [
  'archive-then-delete-30d',
  'delete-after-upload',
  'keep-forever',
] as const;
export type RetentionPolicy = (typeof RETENTION_POLICY)[number];
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = 'archive-then-delete-30d';

// Whether finished matches upload to YouTube automatically or only on request.
// Defaults to manual so uploads are never a surprise.
export const UPLOAD_MODE = ['auto', 'manual'] as const;
export type UploadMode = (typeof UPLOAD_MODE)[number];
export const DEFAULT_UPLOAD_MODE: UploadMode = 'manual';

// Privacy applied to every uploaded VOD. Unlisted (not Private) so the video can
// be played by the embedded in-app player and deep-linked to a timeline moment
// without the viewer having to be signed into the uploader's Google account.
// Single source of truth for both the uploader and any UI copy.
export const YOUTUBE_PRIVACY = 'unlisted' as const;
export type YoutubePrivacy = typeof YOUTUBE_PRIVACY;
export const YOUTUBE_PRIVACY_LABEL = 'Unlisted';

// Lifecycle of a single upload job in the queue.
export const UPLOAD_JOB_STATUS = ['pending', 'running', 'done', 'failed'] as const;
export type UploadJobStatus = (typeof UPLOAD_JOB_STATUS)[number];

export interface UploadJob {
  id: string;
  matchId: string;
  status: UploadJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

// Riot event names we care about (Phase 2 parses these into match_events).
export const RIOT_EVENT_TYPES = [
  'GameStart',
  'GameEnd',
  'FirstBlood',
  'ChampionKill',
  'Multikill',
  'Ace',
  'TurretKilled',
  'InhibKilled',
  'DragonKill',
  'BaronKill',
  'HeraldKill',
  'AtakhanKill',
  // Valorant (synthesized from Insights data; times are on the video clock)
  'RoundStart',
] as const;
export type RiotEventType = (typeof RIOT_EVENT_TYPES)[number];

// ---- Domain entities (the shapes the UI is allowed to see) ----

export interface Match {
  id: string;
  game: Game;
  riotGameId: number | null;
  champion: string | null; // League champion, or Valorant agent
  gameMode: string | null;
  mapName: string | null;
  queueId: number | null;
  recordingStartedAt: number; // epoch ms — game detected (Live Client) or Insights recording start
  gameStartedAt: number | null; // epoch ms — GameStart event observed
  endedAt: number | null;
  durationSeconds: number | null;
  result: MatchResult;
  kills: number;
  deaths: number;
  assists: number;
  // Local player's identity strings (riotId / game name / summoner name) — used
  // to attribute events like FirstBlood/Multikill to the player. Empty until
  // observed live (or backfilled).
  playerIdentities: string[];
  vodLocalPath: string | null;
  // Seconds to add to an in-game time to get its position in the VOD
  // (vodSeconds = gameSeconds + vodOffsetSeconds). Negative when the recording
  // started after GameStart. Null for matches without a measured offset; see
  // vodOffsetSeconds() in vodTiming.ts for the fallback.
  vodOffsetSeconds: number | null;
  vodDurationSeconds: number | null;
  // Insights Capture's own id for the recording this VOD came from.
  insightsVideoUuid: string | null;
  vodStatus: VodStatus;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  archivedAt: number | null;
  recordingError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MatchEvent {
  id: string;
  matchId: string;
  eventType: string;
  eventTimeSeconds: number; // in-game time (League) or video time (Valorant)
  wallClockAt: number;
  killerName: string | null;
  victimName: string | null;
  assisters: string[];
  payload: unknown;
  createdAt: number;
}

// ---- Insights Capture integration ----

export interface InsightsSettings {
  // Folder Insights saves recordings to. Empty = use Insights' own
  // videoLibrary.location setting (read from its database).
  videoDir: string;
  // Path to Insights' db.sqlite3. Empty = %APPDATA%\Insights Capture\db.sqlite3.
  dbPath: string;
}

export interface InsightsStatus {
  state: InsightsWatchState;
  videoDir: string; // resolved folder actually being watched
  dbAvailable: boolean; // Insights' database could be opened
  lastIngestAt: number | null;
  lastError: string | null;
}

// ---- Live recorder status pushed to the UI ----

export interface RecorderStatus {
  state: RecorderState;
  insights: InsightsStatus;
  currentMatchId: string | null;
  lastError: string | null;
}
