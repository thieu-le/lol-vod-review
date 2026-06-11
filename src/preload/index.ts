import { contextBridge, ipcRenderer } from 'electron';
import { IPC, PUSH } from '@shared/ipc-contract';
import type {
  BackfillSummary,
  MatchHighlights,
  ObsApplyResult,
  ObsRecordingConfig,
  ObsSettingsInput,
  ObsSettingsView,
  ObsTestResult,
  RendererApi,
  UploadProgress,
  VodOpenResult,
  YoutubeConnectResult,
  YoutubeSettingsInput,
  YoutubeSettingsView,
  YoutubeStatus,
} from '@shared/ipc-contract';
import type {
  Match,
  MatchEvent,
  ObsNvencEncoder,
  RecorderStatus,
  RetentionPolicy,
  UploadJob,
} from '@shared/types';

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
    getEvents: (id) => ipcRenderer.invoke(IPC.matchesGetEvents, id) as Promise<MatchEvent[]>,
    getHighlights: (ids) =>
      ipcRenderer.invoke(IPC.matchesGetHighlights, ids) as Promise<Record<string, MatchHighlights>>,
    delete: (id) => ipcRenderer.invoke(IPC.matchesDelete, id) as Promise<void>,
  },
  vod: {
    openLocal: (id) => ipcRenderer.invoke(IPC.vodOpenLocal, id) as Promise<VodOpenResult>,
    reveal: (id) => ipcRenderer.invoke(IPC.vodReveal, id) as Promise<VodOpenResult>,
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
    getRecordingConfig: () =>
      ipcRenderer.invoke(IPC.obsGetRecordingConfig) as Promise<ObsRecordingConfig | null>,
    applyRecommended: (encoder: ObsNvencEncoder) =>
      ipcRenderer.invoke(IPC.obsApplyRecommended, encoder) as Promise<ObsApplyResult>,
  },
  settings: {
    getObs: () => ipcRenderer.invoke(IPC.settingsGetObs) as Promise<ObsSettingsView>,
    setObs: (input: ObsSettingsInput) =>
      ipcRenderer.invoke(IPC.settingsSetObs, input) as Promise<ObsSettingsView>,
    getRetention: () => ipcRenderer.invoke(IPC.settingsGetRetention) as Promise<RetentionPolicy>,
    setRetention: (policy: RetentionPolicy) =>
      ipcRenderer.invoke(IPC.settingsSetRetention, policy) as Promise<RetentionPolicy>,
    getLaunchAtLogin: () => ipcRenderer.invoke(IPC.settingsGetLaunchAtLogin) as Promise<boolean>,
    setLaunchAtLogin: (enabled: boolean) =>
      ipcRenderer.invoke(IPC.settingsSetLaunchAtLogin, enabled) as Promise<boolean>,
    getRankedOnly: () => ipcRenderer.invoke(IPC.settingsGetRankedOnly) as Promise<boolean>,
    setRankedOnly: (enabled: boolean) =>
      ipcRenderer.invoke(IPC.settingsSetRankedOnly, enabled) as Promise<boolean>,
  },
  maintenance: {
    backfill: () => ipcRenderer.invoke(IPC.maintenanceBackfill) as Promise<BackfillSummary>,
  },
  youtube: {
    getStatus: () => ipcRenderer.invoke(IPC.youtubeStatus) as Promise<YoutubeStatus>,
    connect: () => ipcRenderer.invoke(IPC.youtubeConnect) as Promise<YoutubeConnectResult>,
    disconnect: () => ipcRenderer.invoke(IPC.youtubeDisconnect) as Promise<YoutubeStatus>,
    getSettings: () => ipcRenderer.invoke(IPC.youtubeGetSettings) as Promise<YoutubeSettingsView>,
    setSettings: (input: YoutubeSettingsInput) =>
      ipcRenderer.invoke(IPC.youtubeSetSettings, input) as Promise<YoutubeSettingsView>,
  },
  uploads: {
    uploadNow: (id) => ipcRenderer.invoke(IPC.uploadsUploadNow, id) as Promise<void>,
    retry: (id) => ipcRenderer.invoke(IPC.uploadsRetry, id) as Promise<void>,
    getForMatch: (id) => ipcRenderer.invoke(IPC.uploadsGetForMatch, id) as Promise<UploadJob | null>,
    onProgress: (cb) => subscribe<UploadProgress>(PUSH.uploadProgress, cb),
    onChanged: (cb) => subscribe<void>(PUSH.uploadChanged, cb),
  },
  updater: {
    onUpdateDownloaded: (cb) => subscribe<string>(PUSH.updateDownloaded, cb),
    quitAndInstall: () => ipcRenderer.invoke(IPC.updaterQuitAndInstall) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('api', api);
