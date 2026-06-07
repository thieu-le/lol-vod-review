// Single source of truth for IPC: channel names + request/response payloads,
// shared by main (handlers), preload (bridge), and renderer (typed client).

import type {
  Match,
  MatchEvent,
  ObsNvencEncoder,
  RecorderStatus,
  RetentionPolicy,
  UploadJob,
  UploadMode,
} from './types';

// Request/response channels (ipcRenderer.invoke <-> ipcMain.handle)
export const IPC = {
  matchesList: 'matches:list',
  matchesGet: 'matches:get',
  matchesGetEvents: 'matches:getEvents',
  matchesDelete: 'matches:delete',
  recorderGetStatus: 'recorder:getStatus',
  recorderStartManual: 'recorder:startManual',
  recorderStopManual: 'recorder:stopManual',
  obsTestConnection: 'obs:testConnection',
  obsGetRecordingConfig: 'obs:getRecordingConfig',
  obsApplyRecommended: 'obs:applyRecommended',
  settingsGetObs: 'settings:getObs',
  settingsSetObs: 'settings:setObs',
  settingsGetRetention: 'settings:getRetention',
  settingsSetRetention: 'settings:setRetention',
  settingsGetLaunchAtLogin: 'settings:getLaunchAtLogin',
  settingsSetLaunchAtLogin: 'settings:setLaunchAtLogin',
  settingsGetRankedOnly: 'settings:getRankedOnly',
  settingsSetRankedOnly: 'settings:setRankedOnly',
  vodOpenLocal: 'vod:openLocal',
  vodReveal: 'vod:reveal',
  maintenanceBackfill: 'maintenance:backfill',
  youtubeStatus: 'youtube:status',
  youtubeConnect: 'youtube:connect',
  youtubeDisconnect: 'youtube:disconnect',
  youtubeGetSettings: 'youtube:getSettings',
  youtubeSetSettings: 'youtube:setSettings',
  uploadsUploadNow: 'uploads:uploadNow',
  uploadsRetry: 'uploads:retry',
  uploadsGetForMatch: 'uploads:getForMatch',
  updaterQuitAndInstall: 'updater:quitAndInstall',
} as const;

// Push channels (main -> renderer via webContents.send)
export const PUSH = {
  matchStarted: 'push:match:started',
  matchEnded: 'push:match:ended',
  recorderStatusChanged: 'push:recorder:statusChanged',
  uploadProgress: 'push:upload:progress',
  uploadChanged: 'push:upload:changed',
  updateDownloaded: 'push:update:downloaded',
} as const;

// ---- Request/response payload contracts ----

export interface ObsTestResult {
  ok: boolean;
  obsVersion?: string;
  websocketVersion?: string;
  error?: string;
}

// Current OBS recording-relevant config, read back over the WebSocket.
export interface ObsRecordingConfig {
  outputMode: string; // 'Simple' | 'Advanced'
  encoder: string; // SimpleOutput/RecEncoder id
  quality: string; // SimpleOutput/RecQuality
  format: string; // SimpleOutput/RecFormat2
  baseWidth: number;
  baseHeight: number;
  outputWidth: number;
  outputHeight: number;
  fps: number;
}

// Result of pushing recommended settings into OBS. `applied` is read back after
// writing; `warnings` flags anything that didn't stick (encoder ids vary by OBS
// version/GPU) so the UI can tell the user what to verify manually.
export interface ObsApplyResult {
  ok: boolean;
  applied?: ObsRecordingConfig;
  warnings?: string[];
  error?: string;
}

// Password is write-only from the UI; reads never return it.
export interface ObsSettingsView {
  host: string;
  port: number;
  hasPassword: boolean;
}

export interface ObsSettingsInput {
  host: string;
  port: number;
  password?: string; // omitted = leave existing password unchanged
}

export interface BackfillSummary {
  matchesProcessed: number;
  eventsInserted: number;
}

// Result of opening/revealing a local VOD file.
export interface VodOpenResult {
  ok: boolean;
  error?: string;
}

// ---- YouTube ----

export interface YoutubeStatus {
  hasCredentials: boolean; // OAuth client id + secret are configured
  connected: boolean; // a refresh token is stored
}

// Client secret is write-only; reads only report whether one is stored.
export interface YoutubeSettingsView {
  clientId: string;
  hasSecret: boolean;
  uploadMode: UploadMode;
}

export interface YoutubeSettingsInput {
  clientId: string;
  clientSecret?: string; // omitted = leave existing secret unchanged
  uploadMode: UploadMode;
}

export interface YoutubeConnectResult {
  ok: boolean;
  error?: string;
  status: YoutubeStatus;
}

// Upload progress for one match (0–100), pushed during an active upload.
export interface UploadProgress {
  matchId: string;
  pct: number;
}

// The typed API surface exposed on window.api by the preload bridge.
export interface RendererApi {
  matches: {
    list(limit?: number): Promise<Match[]>;
    get(id: string): Promise<Match | null>;
    getEvents(id: string): Promise<MatchEvent[]>;
    delete(id: string): Promise<void>;
  };
  vod: {
    openLocal(matchId: string): Promise<VodOpenResult>;
    reveal(matchId: string): Promise<VodOpenResult>;
  };
  recorder: {
    getStatus(): Promise<RecorderStatus>;
    startManual(): Promise<void>;
    stopManual(): Promise<void>;
    onStatusChanged(cb: (status: RecorderStatus) => void): () => void;
    onMatchStarted(cb: (match: Match) => void): () => void;
    onMatchEnded(cb: (match: Match) => void): () => void;
  };
  obs: {
    testConnection(): Promise<ObsTestResult>;
    getRecordingConfig(): Promise<ObsRecordingConfig | null>;
    applyRecommended(encoder: ObsNvencEncoder): Promise<ObsApplyResult>;
  };
  settings: {
    getObs(): Promise<ObsSettingsView>;
    setObs(input: ObsSettingsInput): Promise<ObsSettingsView>;
    getRetention(): Promise<RetentionPolicy>;
    setRetention(policy: RetentionPolicy): Promise<RetentionPolicy>;
    getLaunchAtLogin(): Promise<boolean>;
    setLaunchAtLogin(enabled: boolean): Promise<boolean>;
    getRankedOnly(): Promise<boolean>;
    setRankedOnly(enabled: boolean): Promise<boolean>;
  };
  maintenance: {
    backfill(): Promise<BackfillSummary>;
  };
  youtube: {
    getStatus(): Promise<YoutubeStatus>;
    connect(): Promise<YoutubeConnectResult>;
    disconnect(): Promise<YoutubeStatus>;
    getSettings(): Promise<YoutubeSettingsView>;
    setSettings(input: YoutubeSettingsInput): Promise<YoutubeSettingsView>;
  };
  uploads: {
    uploadNow(matchId: string): Promise<void>;
    retry(matchId: string): Promise<void>;
    getForMatch(matchId: string): Promise<UploadJob | null>;
    onProgress(cb: (p: UploadProgress) => void): () => void;
    onChanged(cb: () => void): () => void;
  };
  updater: {
    // Fires with the new version string once an update is downloaded and staged.
    onUpdateDownloaded(cb: (version: string) => void): () => void;
    // Quit and apply the staged update now, relaunching afterward.
    quitAndInstall(): Promise<void>;
  };
}
