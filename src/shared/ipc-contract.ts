// Single source of truth for IPC: channel names + request/response payloads,
// shared by main (handlers), preload (bridge), and renderer (typed client).

import type {
  InsightsSettings,
  InsightsStatus,
  Match,
  MatchEvent,
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
  matchesGetHighlights: 'matches:getHighlights',
  matchesDelete: 'matches:delete',
  recorderGetStatus: 'recorder:getStatus',
  recorderStartManual: 'recorder:startManual',
  recorderStopManual: 'recorder:stopManual',
  settingsGetInsights: 'settings:getInsights',
  settingsSetInsights: 'settings:setInsights',
  insightsScanNow: 'insights:scanNow',
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
  // A recording from Insights was attached to a (possibly new) match.
  matchIngested: 'push:match:ingested',
  recorderStatusChanged: 'push:recorder:statusChanged',
  uploadProgress: 'push:upload:progress',
  uploadChanged: 'push:upload:changed',
  updateDownloaded: 'push:update:downloaded',
} as const;

// ---- Request/response payload contracts ----

// Insights settings plus what they currently resolve to (folder actually
// watched, database found), so the UI can show both.
export interface InsightsSettingsView {
  settings: InsightsSettings;
  status: InsightsStatus;
  resolvedDbPath: string;
}

export interface BackfillSummary {
  matchesProcessed: number;
  eventsInserted: number;
}

// Player-attributed highlight signals for a match, derived from stored events.
// `killStreak` is the largest Multikill streak (2=double … 5=penta), null if none.
export interface MatchHighlights {
  firstBlood: boolean;
  ace: boolean;
  killStreak: number | null;
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
    // Batched: one call for all visible matches; keys are match ids.
    getHighlights(ids: string[]): Promise<Record<string, MatchHighlights>>;
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
    onMatchIngested(cb: (match: Match) => void): () => void;
  };
  insights: {
    getSettings(): Promise<InsightsSettingsView>;
    setSettings(input: InsightsSettings): Promise<InsightsSettingsView>;
    scanNow(): Promise<InsightsSettingsView>;
  };
  settings: {
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
