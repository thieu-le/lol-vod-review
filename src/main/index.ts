import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import log from './lib/logger';
import { paths } from './lib/paths';
import { getDb, closeDb } from './services/database/db';
import { registerIpcHandlers } from './ipc/handlers';
import { recorderController } from './services/recorder/recorderController';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: '#0d1117',
    title: 'LoL VOD Review',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  // Open external links in the default browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function bootstrap(): void {
  mkdirSync(paths.logsDir(), { recursive: true });
  mkdirSync(paths.archiveDir(), { recursive: true });

  // Open DB + run migrations before anything touches it.
  getDb();

  registerIpcHandlers(() => mainWindow);
  createWindow();
  recorderController.start();
}

app.whenReady().then(() => {
  bootstrap();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  recorderController.stop();
  closeDb();
});

process.on('uncaughtException', (err) => log.error('uncaughtException', err));
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason));
