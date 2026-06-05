import { Tray, Menu, nativeImage } from 'electron';

// Embedded so the tray always has an icon with zero file-path resolution in dev
// vs packaged builds. Written by scripts/import-icon.mjs (do not hand-edit).
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAADx0lEQVR42mNgGAWjgM7gxo0bYEwymDR9kUFkTHLF1Tv3KXbErVu3SNPQ2D7Rwy645Z113Lr/mfk1pf///6dPcG3acVQ2LDZvvlX4zH9upQ//Oxdc/28dtfhfRl51/cWLtxlpYunhExfFG9smhvqEZqy0Dm7/aZdx/L9j7oX/dgFVrwOjC3abh876bxG14n9gVMHWdZv3y1DN4gOHTks6++c8tg5s+28YOOe/feap//aZJ/8bB0z67xtRsHfxyq0K16/fY6jrmx3iGlv1TMOl9r+FZ9HnmMTs1p27DkpQ7ICjJy5Kmfs1/zeNXPXf2Lv5v2t4/WufkNTFfZPnObjNPiwXMWVDfPT0jXFRU9cGxExa6VHeOd0jKDyp39Yt6rqtncMPT0/PLRs3buQj2wFXrtxmdA6p/qTl1vp/2qxlmWcv3mJ0m3ZIP3zC2rTECcvc9+3bx5S74iTn1atXMfSeOnWKb//+/Rrnzp2jLF24BmYdNgyc/T8yJqnKpXv7JO+ezRu9ureWBk7er5w+/4i0V/fm1THTdmecPHOONqneJyCi1cB/5n9bv9Qbeb2L9AK7t9QE1s2rC+5c3xXSsXaNb9u6Lo/WjQdC+7Yb08QBHT1TXVSscv/bemW+O3/+CjNILLFzhYFXw+oS/+b1s2yrN1wMrFsW6lK34bpv47qIlMl7+anqgBMnznNauKZ8VjJN/D9n3nJrZLkdu3YxhTatXxzUtDHIp2pZn3vF8krf2tWd1ZNXylHVEe4+EcuVbYr/BwRH96HLeRUvbY6uW+rgXrw4y6N4aZVb4fIEqkdDW3ufk5x+yH9Lp8jnp0+fYUWWs0hZdtA5c0mZS+b8/Q7pC3I8chbVw+RAuePw4cOUO+DcuXMMlvaBF6W0/P5X1zSGw8RNopYYmkbO/pVWMd3dIXW5g2fGolz/7NkhNEmMhYWl8RLqHv/tXQJOX7p0iVHPb262UcDM6z5JU8BBbh46N8YtfubOGbMXctHEASdPnmKytPU8J65k8z8iub3d0HvK5aKqiZKw+tw1anqvbcisxdaB06NoVhO2t3fayqpa/pVWtv9fXD1TZ//+/QysrKwqzMzM5srKyqyxmZMsahsniNPMAZcuXWKIjonv5RFV/x8Xn9ACcgDIciYmJh9GRkYOurQHTpw4wers6nVQSk7jd2trq+2AtOF27NghZGlld1FTU+/58uXLZQfEEVu3bhW2t3c8ZmxicnXTpk1ilJp3+/Zt0hUfPXqUIzQ0dLqTk9PVpUuXyjEMFGhqanKOjo72GO1gjAJqAQB0YpVK9P8bmAAAAABJRU5ErkJggg==';

let tray: Tray | null = null;
let handlers: TrayHandlers | null = null;

export interface TrayHandlers {
  onOpen: () => void;
  getLaunchAtLogin: () => boolean;
  setLaunchAtLogin: (enabled: boolean) => void;
  onQuit: () => void;
}

function buildMenu(): Menu {
  const h = handlers!;
  return Menu.buildFromTemplate([
    { label: 'Open LoL VOD Review', click: () => h.onOpen() },
    { type: 'separator' },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: h.getLaunchAtLogin(),
      click: (item) => h.setLaunchAtLogin(item.checked),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => h.onQuit() },
  ]);
}

export function createAppTray(h: TrayHandlers): Tray {
  if (tray) return tray;
  handlers = h;

  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON_DATA_URL));
  tray.setToolTip('LoL VOD Review');
  tray.setContextMenu(buildMenu());
  // Windows: a single click should surface the window.
  tray.on('click', () => h.onOpen());
  tray.on('double-click', () => h.onOpen());

  return tray;
}

// Re-sync the checkbox after the setting changes elsewhere (e.g. Settings UI).
export function refreshTrayMenu(): void {
  if (tray && handlers) tray.setContextMenu(buildMenu());
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
  handlers = null;
}
