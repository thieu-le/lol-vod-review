import { contextBridge, ipcRenderer } from 'electron';
import { IPC, PUSH } from '@shared/ipc-contract';
import type {
  ObsSettingsInput,
  ObsSettingsView,
  ObsTestResult,
  RendererApi,
} from '@shared/ipc-contract';
import type { Match, RecorderStatus } from '@shared/types';

// Wraps a push channel as a subscribe(cb) -> unsubscribe() helper.
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: RendererApi = {
  matches: {
    list: (limit) => ipcRenderer.invoke(IPC.matchesList, limit) as Promise<Match[]>,
    get: (id) => ipcRenderer.invoke(IPC.matchesGet, id) as Promise<Match | null>,
    delete: (id) => ipcRenderer.invoke(IPC.matchesDelete, id) as Promise<void>,
  },
  recorder: {
    getStatus: () => ipcRenderer.invoke(IPC.recorderGetStatus) as Promise<RecorderStatus>,
    startManual: () => ipcRenderer.invoke(IPC.recorderStartManual) as Promise<void>,
    stopManual: () => ipcRenderer.invoke(IPC.recorderStopManual) as Promise<void>,
    onStatusChanged: (cb) => subscribe<RecorderStatus>(PUSH.recorderStatusChanged, cb),
    onMatchStarted: (cb) => subscribe<Match>(PUSH.matchStarted, cb),
    onMatchEnded: (cb) => subscribe<Match>(PUSH.matchEnded, cb),
  },
  obs: {
    testConnection: () => ipcRenderer.invoke(IPC.obsTestConnection) as Promise<ObsTestResult>,
  },
  settings: {
    getObs: () => ipcRenderer.invoke(IPC.settingsGetObs) as Promise<ObsSettingsView>,
    setObs: (input: ObsSettingsInput) =>
      ipcRenderer.invoke(IPC.settingsSetObs, input) as Promise<ObsSettingsView>,
  },
};

contextBridge.exposeInMainWorld('api', api);
