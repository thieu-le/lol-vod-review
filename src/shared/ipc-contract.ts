// Single source of truth for IPC: channel names + request/response payloads,
// shared by main (handlers), preload (bridge), and renderer (typed client).

import type { Match, RecorderStatus } from './types';

// Request/response channels (ipcRenderer.invoke <-> ipcMain.handle)
export const IPC = {
  matchesList: 'matches:list',
  matchesGet: 'matches:get',
  matchesDelete: 'matches:delete',
  recorderGetStatus: 'recorder:getStatus',
  recorderStartManual: 'recorder:startManual',
  recorderStopManual: 'recorder:stopManual',
  obsTestConnection: 'obs:testConnection',
  settingsGetObs: 'settings:getObs',
  settingsSetObs: 'settings:setObs',
} as const;

// Push channels (main -> renderer via webContents.send)
export const PUSH = {
  matchStarted: 'push:match:started',
  matchEnded: 'push:match:ended',
  recorderStatusChanged: 'push:recorder:statusChanged',
} as const;

// ---- Request/response payload contracts ----

export interface ObsTestResult {
  ok: boolean;
  obsVersion?: string;
  websocketVersion?: string;
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

// The typed API surface exposed on window.api by the preload bridge.
export interface RendererApi {
  matches: {
    list(limit?: number): Promise<Match[]>;
    get(id: string): Promise<Match | null>;
    delete(id: string): Promise<void>;
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
  };
  settings: {
    getObs(): Promise<ObsSettingsView>;
    setObs(input: ObsSettingsInput): Promise<ObsSettingsView>;
  };
}
