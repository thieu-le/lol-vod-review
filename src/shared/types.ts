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
