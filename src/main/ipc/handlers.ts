import { ipcMain, shell, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { IPC, PUSH } from '@shared/ipc-contract';
import type {
  InsightsSettingsView,
  VodOpenResult,
  YoutubeConnectResult,
  YoutubeSettingsView,
} from '@shared/ipc-contract';
import { RETENTION_POLICY, UPLOAD_MODE } from '@shared/types';
import { toMessage } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { matchRepository } from '../services/database/repositories/matchRepository';
import { eventRepository } from '../services/database/repositories/eventRepository';
import { settingsRepository } from '../services/database/repositories/settingsRepository';
import { insightsWatcher } from '../services/insights/insightsWatcher';
import { recorderController } from '../services/recorder/recorderController';
import { retroBackfillAll } from '../services/recorder/backfill';
import { uploadController } from '../services/youtube/uploadController';
import { applyLaunchAtLogin } from '../lib/autostart';
import { refreshTrayMenu } from '../lib/tray';
import {
  connect as youtubeConnect,
  disconnect as youtubeDisconnect,
  getAuthStatus,
} from '../services/youtube/auth';

const logger = createLogger('ipc');

const idSchema = z.string().uuid();
const listSchema = z.number().int().positive().max(500).optional();
const insightsInputSchema = z.object({
  videoDir: z.string().max(1024),
  dbPath: z.string().max(1024),
});
const retentionSchema = z.enum(RETENTION_POLICY);
const youtubeInputSchema = z.object({
  clientId: z.string().max(512),
  clientSecret: z.string().max(512).optional(),
  uploadMode: z.enum(UPLOAD_MODE),
});

function insightsView(): InsightsSettingsView {
  return {
    settings: settingsRepository().getInsights(),
    status: insightsWatcher.getStatus(),
    resolvedDbPath: insightsWatcher.resolvePaths().dbPath,
  };
}

function youtubeView(): YoutubeSettingsView {
  const cfg = settingsRepository().getYoutubeConfig();
  return {
    clientId: cfg.clientId,
    hasSecret: settingsRepository().hasYoutubeSecret(),
    uploadMode: settingsRepository().getUploadMode(),
  };
}

// Registers all request/response handlers and wires push events to the window.
export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.matchesList, (_e, limit: unknown) => {
    const n = listSchema.parse(limit);
    return matchRepository().list(n);
  });

  ipcMain.handle(IPC.matchesGet, (_e, id: unknown) => {
    return matchRepository().get(idSchema.parse(id));
  });

  ipcMain.handle(IPC.matchesGetEvents, (_e, id: unknown) => {
    return eventRepository().listForMatch(idSchema.parse(id));
  });

  ipcMain.handle(IPC.matchesGetHighlights, (_e, ids: unknown) => {
    const parsed = z.array(idSchema).max(200).parse(ids);
    return eventRepository().highlightsForMatches(parsed);
  });

  ipcMain.handle(IPC.matchesDelete, (_e, id: unknown) => {
    matchRepository().delete(idSchema.parse(id));
  });

  // Open / reveal the recorded VOD file via the OS default handler.
  ipcMain.handle(IPC.vodOpenLocal, async (_e, id: unknown): Promise<VodOpenResult> => {
    const match = matchRepository().get(idSchema.parse(id));
    if (!match?.vodLocalPath) return { ok: false, error: 'No recording on file for this match' };
    const err = await shell.openPath(match.vodLocalPath);
    return err ? { ok: false, error: err } : { ok: true };
  });

  ipcMain.handle(IPC.vodReveal, (_e, id: unknown): VodOpenResult => {
    const match = matchRepository().get(idSchema.parse(id));
    if (!match?.vodLocalPath) return { ok: false, error: 'No recording on file for this match' };
    shell.showItemInFolder(match.vodLocalPath);
    return { ok: true };
  });

  ipcMain.handle(IPC.recorderGetStatus, () => recorderController.getStatus());
  ipcMain.handle(IPC.recorderStartManual, () => recorderController.startManual());
  ipcMain.handle(IPC.recorderStopManual, () => recorderController.stopManual());

  ipcMain.handle(IPC.maintenanceBackfill, () => retroBackfillAll());

  ipcMain.handle(IPC.settingsGetInsights, () => insightsView());
  ipcMain.handle(IPC.settingsSetInsights, (_e, input: unknown) => {
    settingsRepository().setInsights(insightsInputSchema.parse(input));
    insightsWatcher.scanNow();
    return insightsView();
  });
  ipcMain.handle(IPC.insightsScanNow, () => {
    insightsWatcher.scanNow();
    return insightsView();
  });

  ipcMain.handle(IPC.settingsGetRetention, () => settingsRepository().getRetention());
  ipcMain.handle(IPC.settingsSetRetention, (_e, policy: unknown) => {
    const parsed = retentionSchema.parse(policy);
    settingsRepository().setRetention(parsed);
    return parsed;
  });

  ipcMain.handle(IPC.settingsGetLaunchAtLogin, () => settingsRepository().getLaunchAtLogin());
  ipcMain.handle(IPC.settingsSetLaunchAtLogin, (_e, enabled: unknown) => {
    const parsed = z.boolean().parse(enabled);
    settingsRepository().setLaunchAtLogin(parsed);
    applyLaunchAtLogin(parsed);
    refreshTrayMenu();
    return parsed;
  });

  ipcMain.handle(IPC.settingsGetRankedOnly, () => settingsRepository().getRankedOnly());
  ipcMain.handle(IPC.settingsSetRankedOnly, (_e, enabled: unknown) => {
    const parsed = z.boolean().parse(enabled);
    settingsRepository().setRankedOnly(parsed);
    return parsed;
  });

  // ---- YouTube account + settings ----
  ipcMain.handle(IPC.youtubeStatus, () => getAuthStatus());
  ipcMain.handle(IPC.youtubeConnect, async (): Promise<YoutubeConnectResult> => {
    try {
      const status = await youtubeConnect();
      uploadController.resume(); // send anything queued while disconnected
      return { ok: true, status };
    } catch (err) {
      return { ok: false, error: toMessage(err), status: getAuthStatus() };
    }
  });
  ipcMain.handle(IPC.youtubeDisconnect, () => {
    youtubeDisconnect();
    return getAuthStatus();
  });
  ipcMain.handle(IPC.youtubeGetSettings, () => youtubeView());
  ipcMain.handle(IPC.youtubeSetSettings, (_e, input: unknown) => {
    const parsed = youtubeInputSchema.parse(input);
    settingsRepository().setYoutubeConfig({
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
    });
    settingsRepository().setUploadMode(parsed.uploadMode);
    return youtubeView();
  });

  // ---- Upload queue ----
  ipcMain.handle(IPC.uploadsUploadNow, (_e, id: unknown) => {
    uploadController.enqueue(idSchema.parse(id));
  });
  ipcMain.handle(IPC.uploadsRetry, (_e, id: unknown) => {
    uploadController.retry(idSchema.parse(id));
  });
  ipcMain.handle(IPC.uploadsGetForMatch, (_e, id: unknown) => {
    return uploadController.getJobForMatch(idSchema.parse(id));
  });

  // Push events: forward controller/watcher state to the renderer.
  const send = (channel: string, payload: unknown) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  recorderController.on('status', (status) => send(PUSH.recorderStatusChanged, status));
  recorderController.on('matchStarted', (match) => send(PUSH.matchStarted, match));
  recorderController.on('matchEnded', (match) => send(PUSH.matchEnded, match));
  // Every new Insights recording (League or Valorant) lands here once its file
  // is finished; queue it for YouTube when auto-upload is on. If no account is
  // connected yet the job waits in the queue until one is.
  insightsWatcher.on('ingested', (match) => {
    send(PUSH.matchIngested, match);
    uploadController.enqueueIfAuto(match.id);
  });

  uploadController.on('progress', (p) => send(PUSH.uploadProgress, p));
  uploadController.on('changed', () => send(PUSH.uploadChanged, undefined));

  logger.info('IPC handlers registered');
}
