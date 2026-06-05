import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from './logger';

const logger = log.scope('updater');

// How often to re-check for updates while the app sits in the tray.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface UpdaterOptions {
  // Fired once an update has finished downloading and is staged to install on
  // restart, so the UI can nudge the user to relaunch.
  onUpdateDownloaded: (version: string) => void;
}

let initialized = false;

// Wires electron-updater against the GitHub Releases feed (configured in
// electron-builder.yml). Downloads updates in the background and stages them to
// install on the next quit. No-ops in dev / unpackaged builds, where there's no
// feed and autoUpdater would otherwise throw.
export function initAutoUpdater(opts: UpdaterOptions): void {
  if (initialized) return;
  initialized = true;

  if (!app.isPackaged) {
    logger.info('Skipping auto-update in unpackaged build');
    return;
  }

  autoUpdater.logger = logger;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => logger.info('Update available:', info.version));
  autoUpdater.on('update-not-available', () => logger.info('No update available'));
  autoUpdater.on('update-downloaded', (info) => {
    logger.info('Update downloaded:', info.version);
    opts.onUpdateDownloaded(info.version);
  });
  autoUpdater.on('error', (err) => logger.warn('Auto-update error:', err?.message ?? err));

  const check = () =>
    autoUpdater
      .checkForUpdates()
      .catch((err) => logger.warn('checkForUpdates failed:', err?.message ?? err));
  void check();
  setInterval(() => void check(), CHECK_INTERVAL_MS).unref();
}

// Quit and apply a downloaded update now (the caller must allow the app to
// actually quit — the tray app normally only hides on window close).
export function quitAndInstallUpdate(): void {
  autoUpdater.quitAndInstall(false, true); // visible installer, relaunch after
}
