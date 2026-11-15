# Never Tilt Again

[![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)
[![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org)
[![Release](https://img.shields.io/github/v/release/thieu-le/lol-vod-review?label=release)](https://github.com/thieu-le/lol-vod-review/releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

An add-on for [Insights Capture](https://insights.gg). Insights records your
League of Legends and VALORANT games; this app picks up every new full-match
recording, builds a KDA + objective (League) or round-by-round (VALORANT)
timeline for it, and uploads it to YouTube as **Unlisted** with clickable
chapter timestamps. You can watch it back in-app: the local file can be
deleted, and the YouTube copy streams in an embedded player you can jump around
by clicking timeline events.

> Play a game → Insights records it → the match shows up in history with
> champion/agent, result, KDA and timestamps → it's queued for YouTube with
> chapters → the local file is archived and cleaned up on a safe schedule.
> Zero manual input during a game.

Built with Electron + React + TypeScript (electron-vite), better-sqlite3, the
Riot Live Client API, and Insights Capture's local database (read-only).

---

## Prerequisites

- **Node.js 18+** and npm.
- **Insights Capture** (Windows), set to record full matches for League of
  Legends and/or VALORANT. Its Capture mode must produce full-match files
  (`League of Legends - <date>.mp4`, `VALORANT - <date>.mp4`), not only highlights.
- **League of Legends** (optional backup data) — during League games the app
  also polls the in-client Live Client API on `https://127.0.0.1:2999`.
- A native toolchain for building `better-sqlite3` (Xcode CLT on macOS, or
  Visual Studio Build Tools / "Desktop development with C++" on Windows).

## Quick start (Windows)

1. Install [Node.js 18+](https://nodejs.org) and [Insights Capture](https://insights.gg).
2. Double-click **`setup-windows.bat`** in the project folder. It installs
   dependencies, rebuilds the native module, and runs the environment check.
3. Run `npm run dev`. The app finds Insights' video folder and database on its
   own; override either in **Settings → Insights Capture**.

If anything looks off at any point, run **`npm run doctor`**. It checks Node,
the native module, Insights Capture, and League's Live Client, and tells you how
to fix whatever isn't ready.

## Install as a background app (Windows)

For day-to-day use you don't want a terminal — you want an installed app that sits
in the tray and records automatically. Build the installer once:

```bash
npm run package:win   # outputs dist/Never Tilt Again Setup <version>.exe
```

Run that `Setup.exe`. It installs like any Windows program (Start Menu + desktop
shortcut). After that:

- **Runs in the background** — the app lives in the **system tray**. Closing the
  window minimizes it to the tray (recording keeps running); it does not quit.
- **Launches at login** — on by default, starting hidden in the tray so games
  record without you opening anything. Toggle it in **Settings → Recordings →
  Startup**, or from the tray's right-click menu.
- **One instance** — relaunching focuses the running app instead of starting a
  second recorder.
- **To quit fully** — right-click the tray icon → **Quit**.

The app/installer icon comes from `npm run import-icon <source.png>` — it
auto-crops the logo, squares it, and writes `build/icon.png` (which
electron-builder converts to the Windows `.ico`) plus the embedded tray icon in
`src/main/lib/tray.ts`.

## Shipping updates (auto-update)

Installed builds update themselves from this repo's **GitHub Releases** — no git
pull, and **no token to download** (the repo is public, so the updater fetches
releases anonymously). The app checks on launch and every few hours; when a new
version is downloaded it shows a "Restart & update" banner (and installs on the
next quit regardless).

To publish a new version, **let GitHub Actions do it** (recommended — uses
GitHub's free built-in token, nothing to configure):

```bash
# 1. bump "version" in package.json (e.g. 0.1.0 -> 0.1.1) and commit
# 2. tag and push:
git tag v0.1.1
git push origin v0.1.1
```

The `.github/workflows/release.yml` workflow builds the Windows installer and
publishes the Release; installed apps pick it up automatically.

> Prefer to publish from your own machine? Copy `electron-builder.env.example` to
> `electron-builder.env`, drop in a GitHub token (`public_repo` scope), and run
> `npm run publish:win`. That file is gitignored. This is optional — CI needs no
> token from you.

## Setup (all platforms)

```bash
npm install        # postinstall runs electron-builder install-app-deps
npm run doctor     # preflight: verify Node, native module, Insights, Live Client
npm run dev        # launch the app in development
```

`npm install`'s `postinstall` rebuilds native modules (`better-sqlite3`) against
Electron's ABI. If you ever switch Node/Electron versions or hit a native module
ABI error at startup, re-run:

```bash
npm run rebuild    # electron-builder install-app-deps
```

> **Windows caveat:** native rebuilds require the Visual Studio C++ build tools.
> If `better-sqlite3` fails to load, install "Desktop development with C++" from
> the Visual Studio Installer, then `npm run rebuild`.

## Insights Capture

Insights does the recording. The app watches Insights' video folder (by
default whatever Insights has under **Settings → Capture**, e.g.
`T:\Videos\Insights`) and, for each new **full-match** recording:

- **League of Legends** — reads the game's Riot Live Client data that Insights
  stored (every event, players, queue, Riot game id) and merges it with what
  this app captured live, deduped by Riot's event id. The chapter offset is
  measured exactly by pairing your kills/deaths/assists on the game clock with
  Insights' markers for the same moments on the video clock.
- **VALORANT** — reads rounds, your kills/deaths/assists, agent, map, mode,
  final score and result from Insights' data. Chapters are per round.

Highlights, clips and other games in the folder are ignored. Recordings that
were already in the folder the first time the app ran are marked as seen and
never uploaded, so turning this on doesn't flood YouTube with a backlog.

Insights' database (`%APPDATA%\Insights Capture\db.sqlite3`) is opened
**read-only**, briefly, and never written. Its schema is private to Insights
and may change; if it can't be read, League games still get chapters from the
app's own live capture.

## YouTube upload (optional)

Uploads use a **Google Cloud OAuth 2.0 Desktop client** and the YouTube Data API
v3. All uploads are **Unlisted** — not searchable or public, but playable by
anyone with the link. (Unlisted, not Private, is what lets the in-app embedded
player stream a match once its local file has been deleted; Private videos can't
be embedded without the viewer signing into your Google account.)

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project and enable **YouTube Data API v3**.
2. Create an **OAuth client ID** of type **Desktop app**.
3. In the app's **Settings → YouTube**, paste the **Client ID** and **Client
   secret**, choose an upload mode (manual or automatic), and **Save**.
4. Click **Connect YouTube account** — your system browser opens for consent via
   a temporary localhost loopback redirect. The refresh token is encrypted via
   `safeStorage` and is never logged.

Manual mode uploads from a match's detail page; automatic mode enqueues an
upload as soon as each new Insights recording has been imported. Chapter
timestamps are derived from the match events and aligned to the video using the
offset measured at import.

Once a match is uploaded, its detail page embeds a YouTube player and clicking
any timeline event seeks the video to that exact moment (using the same offset).
This means the local recording is disposable: with the **Delete after upload**
retention policy you reclaim the disk immediately and still rewatch every game
from inside the app.

## Retention

After a successful upload the local recording is handled per the **retention
policy** in Settings:

- **Archive then delete after 30 days** (default) — moves the file to an archive
  folder and deletes it only once it has aged out. Moving or deleting a file
  leaves a dead entry in Insights' own library; that's expected. A recording is **never**
  deleted without a confirmed YouTube video ID, so a failed post-upload step
  can't lose your VOD.
- **Delete after upload** — removes the local file once the upload succeeds.
- **Keep forever** — never deletes.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Run the app in development (electron-vite). |
| `npm run doctor` | Environment preflight (Node, native module, Insights, Live Client). |
| `npm run build` | Type-check-free production build of all three processes. |
| `npm run typecheck` | Type-check the node (main/preload) and web (renderer) projects. |
| `npm start` | Preview a production build. |
| `npm run package` | Build + package via electron-builder. |
| `npm run package:win` | Build + package a Windows NSIS installer. |
| `npm run rebuild` | Rebuild native modules against Electron's ABI. |
| `npm run dump` | League event dumper (dev tool, see `tools/league-event-dumper`). |

## How it works

- **Recording** — Insights Capture. A watcher polls its video folder; a file is
  imported once it has stopped changing and Insights has registered it.
- **Live tracking (League)** — a controller polls the Riot Live Client API to
  detect game start/end and capture events, persisting a match row that the
  Insights recording is later attached to.
- **Event parsing** — raw live events are captured verbatim, then parsed into
  structured `match_events` (kills, dragons, barons, heralds, towers, …) and the
  active player's KDA, deterministically (re-parsable from stored snapshots).
- **Storage** — SQLite (better-sqlite3) via a repository layer with versioned,
  append-only migrations. Secrets live in an encrypted KV row, never in plaintext.
- **Upload** — a durable, restart-safe serial queue (`upload_jobs`) performs
  resumable uploads, writes the chaptered description, and records the video URL.

## Security notes

- The renderer is locked down: `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`, with a strict CSP; external links open in the system
  browser.
- The Live Client TLS bypass is scoped to `127.0.0.1:2999` only — never global.
- All IPC inputs are validated with zod.
- Secrets (YouTube client secret + refresh token) are encrypted
  via `safeStorage` and never logged. Never commit `.env`.
