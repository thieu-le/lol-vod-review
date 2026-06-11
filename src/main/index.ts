import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { IPC, PUSH } from '@shared/ipc-contract';
import log from './lib/logger';
import { paths } from './lib/paths';
import { initAutoUpdater, quitAndInstallUpdate } from './lib/updater';
import { getDb, closeDb } from './services/database/db';
import { registerIpcHandlers } from './ipc/handlers';
import { recorderController } from './services/recorder/recorderController';
import { uploadController } from './services/youtube/uploadController';
import { sweepExpired } from './services/files/retention';
import { settingsRepository } from './services/database/repositories/settingsRepository';
import { createAppTray, destroyTray } from './lib/tray';
import { applyLaunchAtLogin, wasLaunchedAtLogin } from './lib/autostart';

// Custom scheme the packaged renderer is served from. Loading over file://
// gives the page a null origin, which YouTube's embed player rejects (error
// "152"). A standard+secure scheme gives a real https-like origin the embed
// accepts, while keeping the CSP `'self'` rules valid.
const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://lol-vod-review`;

// Must run before app `ready`: declare the scheme as standard (real origin) and
// secure (treated like https — no mixed-content downgrade for the embed).
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
// Distinguishes a real quit (tray "Quit" / before-quit) from the user clicking
// the window's close button, which only hides the window to the tray.
let isQuitting = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: '#0d1117',
    title: 'Never Tilt Again',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The match VOD plays in a <webview> pointed at youtube.com/embed. Loading
      // it as the guest's own top-level document (rather than a cross-origin
      // iframe inside our app) avoids the embedder-origin check that fails with a
      // null/non-https origin (YouTube error "152").
      webviewTag: true,
    },
  });

  // Lock down the VOD <webview> guest: no Node, sandboxed, allow autoplay so the
  // player starts when the user clicks a timeline moment.
  mainWindow.webContents.on('will-attach-webview', (_e, webPreferences) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });
  mainWindow.webContents.on('did-attach-webview', (_e, guest) => {
    // Ad/redirect popups from the embed open in the system browser, never a window.
    guest.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
  });

  // DevTools toggle (F12 / Ctrl+Shift+I / Cmd+Opt+I) — available in packaged
  // builds so player/network issues can be inspected. The host DevTools "top"
  // target dropdown also lists the <webview> guest for inspecting the player.
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const toggle =
      key === 'f12' ||
      ((input.control || input.meta) && input.shift && key === 'i') ||
      (input.meta && input.alt && key === 'i');
    if (toggle) mainWindow?.webContents.toggleDevTools();
  });

  // When launched at login we stay in the tray instead of popping the window.
  const startHidden = wasLaunchedAtLogin();
  mainWindow.on('ready-to-show', () => {
    if (!startHidden) mainWindow?.show();
  });

  // Closing the window keeps the app alive in the tray so recording continues in
  // the background. A genuine quit sets isQuitting first.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in the default browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    // Dev: Vite serves the renderer over http://localhost (already a valid origin).
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    // Packaged: serve via the custom app:// scheme so the page has a real origin.
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }
}

// Serve the built renderer (out/renderer) over app://. Files are resolved
// relative to the renderer dir; the path is normalized and confined to that dir
// to prevent traversal outside it.
function registerAppProtocol(): void {
  const rendererDir = join(__dirname, '../renderer');
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const decoded = decodeURIComponent(pathname);
    const rel = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '');
    const filePath = normalize(join(rendererDir, rel));
    // Confine to the renderer directory.
    if (filePath !== rendererDir && !filePath.startsWith(rendererDir + sep)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

// Bring the window forward, recreating it if it was destroyed (e.g. on macOS).
function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
  }
  mainWindow?.show();
  mainWindow?.focus();
}

function quitApp(): void {
  isQuitting = true;
  app.quit();
}

// YouTube's embed player rejects a file:// embedder. In a packaged build the
// renderer loads from file:// (no web origin), which makes the in-app VOD embed
// fail with a player "configuration error". Presenting a real https Referer for
// YouTube's hosts makes the Unlisted video play. (Dev loads over http://localhost
// and already works; this is harmless there.)
function enableYoutubeEmbedPlayback(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://*.youtube-nocookie.com/*',
        'https://*.youtube.com/*',
        'https://*.ytimg.com/*',
        'https://*.googlevideo.com/*',
      ],
    },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://www.youtube.com/';
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

function bootstrap(): void {
  mkdirSync(paths.logsDir(), { recursive: true });
  mkdirSync(paths.archiveDir(), { recursive: true });

  enableYoutubeEmbedPlayback();
  registerAppProtocol();

  // Open DB + run migrations before anything touches it.
  getDb();

  registerIpcHandlers(() => mainWindow);
  createWindow();
  recorderController.start();

  // Resume any interrupted uploads and clean up VODs past their retention window.
  uploadController.start();
  try {
    sweepExpired();
  } catch (err) {
    log.error('retention sweep failed', err);
  }

  // Auto-update from GitHub Releases (packaged builds only). Notify the renderer
  // when an update is staged so it can offer a one-click restart.
  initAutoUpdater({
    onUpdateDownloaded: (version) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(PUSH.updateDownloaded, version);
      }
    },
  });
  // Restart into the freshly downloaded update. isQuitting bypasses the
  // close-to-tray handler so the app actually quits and the installer runs.
  ipcMain.handle(IPC.updaterQuitAndInstall, () => {
    isQuitting = true;
    quitAndInstallUpdate();
  });

  // Background presence: keep the registered login item in sync with the saved
  // preference, then install the tray menu.
  applyLaunchAtLogin(settingsRepository().getLaunchAtLogin());
  createAppTray({
    onOpen: () => showMainWindow(),
    getLaunchAtLogin: () => settingsRepository().getLaunchAtLogin(),
    setLaunchAtLogin: (enabled) => {
      settingsRepository().setLaunchAtLogin(enabled);
      applyLaunchAtLogin(enabled);
    },
    onQuit: () => quitApp(),
  });
}

// Single-instance: a second launch focuses the running instance instead of
// spawning another background recorder.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  app.whenReady().then(() => {
    bootstrap();
    app.on('activate', () => showMainWindow());
  });
}

// Intentionally do NOT quit when the window closes — the app lives in the tray
// and keeps recording. Quit is explicit (tray "Quit").
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  isQuitting = true;
  recorderController.stop();
  closeDb();
  destroyTray();
});

process.on('uncaughtException', (err) => log.error('uncaughtException', err));
process.on('unhandledRejection', (reason) => log.error('unhandledRejection', reason));
