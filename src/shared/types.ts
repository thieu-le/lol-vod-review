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

export const MATCH_RESULT = ['Win', 'Lose', 'Unknown'] as const;
export type MatchResult = (typeof MATCH_RESULT)[number];

// High-level state of the recorder pipeline, surfaced to the UI.
export const RECORDER_STATE = [
  'idle',
  'in_game',
  'post_game',
] as const;
export type RecorderState = (typeof RECORDER_STATE)[number];

export const OBS_CONNECTION_STATE = [
  'disconnected',
  'connecting',
  'connected',
] as const;
export type ObsConnectionState = (typeof OBS_CONNECTION_STATE)[number];

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

// NVENC encoder ids OBS's Simple output mode uses, offered by the "apply
// recommended OBS settings" action (NVIDIA GPUs). AV1 gives the smallest files
// and fastest uploads on RTX 40/50; HEVC is the broad-compatibility default;
// H.264 is the maximum-compatibility fallback.
export const OBS_NVENC_ENCODER = ['nvenc_av1', 'nvenc_hevc', 'nvenc'] as const;
export type ObsNvencEncoder = (typeof OBS_NVENC_ENCODER)[number];
export const DEFAULT_OBS_ENCODER: ObsNvencEncoder = 'nvenc_av1';

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
] as const;
export type RiotEventType = (typeof RIOT_EVENT_TYPES)[number];

// ---- Domain entities (the shapes the UI is allowed to see) ----

export interface Match {
  id: string;
  riotGameId: number | null;
  champion: string | null;
  gameMode: string | null;
  mapName: string | null;
  queueId: number | null;
  recordingStartedAt: number; // epoch ms — OBS record start
  gameStartedAt: number | null; // epoch ms — GameStart event observed
  endedAt: number | null;
  durationSeconds: number | null;
  result: MatchResult;
  kills: number;
  deaths: number;
  assists: number;
  vodLocalPath: string | null;
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
  eventTimeSeconds: number; // in-game time from Live Client
  wallClockAt: number;
  killerName: string | null;
  victimName: string | null;
  assisters: string[];
  payload: unknown;
  createdAt: number;
}

// ---- OBS settings (stored in `settings`; password encrypted separately) ----

export interface ObsSettings {
  host: string;
  port: number;
  password: string; // returned decrypted to main only; never sent raw to UI
}

export const DEFAULT_OBS_SETTINGS: Omit<ObsSettings, 'password'> = {
  host: '127.0.0.1',
  port: 4455,
};

// ---- Live recorder status pushed to the UI ----

export interface RecorderStatus {
  state: RecorderState;
  obs: ObsConnectionState;
  currentMatchId: string | null;
  lastError: string | null;
}
