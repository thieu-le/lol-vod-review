import { ipcMain, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { IPC, PUSH } from '@shared/ipc-contract';
import type { ObsSettingsView, ObsTestResult } from '@shared/ipc-contract';
import { toMessage } from '../lib/errors';
import { createLogger } from '../lib/logger';
import { matchRepository } from '../services/database/repositories/matchRepository';
import { settingsRepository } from '../services/database/repositories/settingsRepository';
import { obsClient } from '../services/obs/obsClient';
import { recorderController } from '../services/recorder/recorderController';

const logger = createLogger('ipc');

const idSchema = z.string().uuid();
const listSchema = z.number().int().positive().max(500).optional();
const obsInputSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  password: z.string().max(512).optional(),
});

function obsView(): ObsSettingsView {
  const s = settingsRepository().getObs();
  return { host: s.host, port: s.port, hasPassword: settingsRepository().hasObsPassword() };
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

  ipcMain.handle(IPC.matchesDelete, (_e, id: unknown) => {
    matchRepository().delete(idSchema.parse(id));
  });

  ipcMain.handle(IPC.recorderGetStatus, () => recorderController.getStatus());
  ipcMain.handle(IPC.recorderStartManual, () => recorderController.startManual());
  ipcMain.handle(IPC.recorderStopManual, () => recorderController.stopManual());

  ipcMain.handle(IPC.obsTestConnection, async (): Promise<ObsTestResult> => {
    try {
      const info = await obsClient.testConnection();
      return { ok: true, obsVersion: info.obsVersion, websocketVersion: info.websocketVersion };
    } catch (err) {
      return { ok: false, error: toMessage(err) };
    }
  });

  ipcMain.handle(IPC.settingsGetObs, () => obsView());
  ipcMain.handle(IPC.settingsSetObs, (_e, input: unknown) => {
    const parsed = obsInputSchema.parse(input);
    settingsRepository().setObs(parsed);
    return obsView();
  });

  // Push events: forward controller/OBS state to the renderer.
  const send = (channel: string, payload: unknown) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  recorderController.on('status', (status) => send(PUSH.recorderStatusChanged, status));
  recorderController.on('matchStarted', (match) => send(PUSH.matchStarted, match));
  recorderController.on('matchEnded', (match) => send(PUSH.matchEnded, match));

  logger.info('IPC handlers registered');
}
