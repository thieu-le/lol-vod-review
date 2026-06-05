import { app } from 'electron';

// Passed to the launched executable when it auto-starts at login, so we know to
// start hidden (tray only) rather than popping the window in the user's face.
export const HIDDEN_FLAG = '--hidden';

// Register / unregister the app as a login item. No-op in dev: there is no
// installed executable to point the OS at, and electron-vite relaunches would
// register the dev binary.
export function applyLaunchAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: [HIDDEN_FLAG],
  });
}

// True when this process was started by the OS login-item mechanism, so the
// window should stay hidden in the tray on boot.
export function wasLaunchedAtLogin(): boolean {
  if (process.argv.includes(HIDDEN_FLAG)) return true;
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin;
  } catch {
    return false;
  }
}
