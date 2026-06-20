// In-app player for a match VOD, rendered in an Electron <webview>.
//
// Why the watch page and not /embed/: videos uploaded through an unverified
// YouTube Data API project are not embeddable — YouTube refuses them at the
// /embed/ endpoint with player error "152" ("owner doesn't allow embedding"),
// even though they play fine on their normal watch page. A <webview> is a real
// top-level browser context (not a third-party iframe), so loading the watch
// page plays the (Unlisted) video regardless of the embed restriction. We get
// YouTube's chrome along with it; a best-effort CSS pass on dom-ready trims the
// most obvious parts down to the player.
//
// Seeking: we remount the webview at a new `&t=` second whenever the caller
// bumps `seek`. The `nonce` lets the same timestamp be re-clicked and re-seek.

import { useEffect, useRef, useState } from 'react';

export interface SeekRequest {
  seconds: number;
  nonce: number;
}

// Hides the heaviest watch-page chrome so the player is the focus. Best-effort:
// if YouTube renames these selectors the rule simply matches nothing and the
// video still plays.
const FOCUS_PLAYER_CSS = `
  #masthead-container, ytd-masthead,
  #related, #comments, #secondary, ytd-watch-metadata,
  tp-yt-app-drawer, ytd-mini-guide-renderer { display: none !important; }
  ytd-watch-flexy { --ytd-watch-flexy-max-player-width: 100vw !important; }
  html, body { overflow: hidden !important; background: #000 !important; }
`;

export function YoutubeEmbed({
  videoId,
  seek,
}: {
  videoId: string;
  seek: SeekRequest | null;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const start = seek ? Math.max(0, Math.floor(seek.seconds)) : 0;
  const src = `https://www.youtube.com/watch?v=${videoId}&t=${start}s`;
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // Remounting on seek re-navigates the webview to the new start second.
  const mountKey = `${videoId}:${seek?.nonce ?? 'init'}`;

  useEffect(() => {
    setLoadError(null);
    const el = ref.current as (HTMLElement & { insertCSS?: (css: string) => void }) | null;
    if (!el) return;

    // Surface hard navigation failures (so the user isn't left on a black box).
    const onFail = (e: Event) => {
      const ev = e as unknown as { errorCode?: number; errorDescription?: string };
      // -3 is ERR_ABORTED, which fires on the normal remount/navigation; ignore.
      if (ev.errorCode === -3) return;
      setLoadError(ev.errorDescription || 'Could not load the player');
    };
    // Trim the watch-page chrome once the guest document is ready.
    const onReady = () => {
      try {
        el.insertCSS?.(FOCUS_PLAYER_CSS);
      } catch {
        // best-effort only
      }
    };
    el.addEventListener('did-fail-load', onFail);
    el.addEventListener('dom-ready', onReady);
    return () => {
      el.removeEventListener('did-fail-load', onFail);
      el.removeEventListener('dom-ready', onReady);
    };
  }, [mountKey]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-edge bg-black">
      <webview
        key={mountKey}
        ref={ref}
        src={src}
        className="h-full w-full"
        // Persist cookies (consent interstitial, optional sign-in) across runs.
        partition="persist:youtube"
        // Let playback start on seek without a fresh gesture inside the guest
        // (the click happened in our window, not the webview).
        webpreferences="autoplayPolicy=no-user-gesture-required"
      />
      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
          <p className="text-sm text-gray-300">Couldn&apos;t play in-app: {loadError}</p>
          <a
            href={watchUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-ink hover:bg-primary-dim"
          >
            Watch on YouTube
          </a>
        </div>
      )}
    </div>
  );
}
