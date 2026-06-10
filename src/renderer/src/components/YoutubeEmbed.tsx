// Embedded YouTube player for a match VOD. Videos are uploaded Unlisted, which
// (unlike Private) can be played in an embed without the viewer being signed in.
//
// We use an Electron <webview> rather than an <iframe>. In a webview the YouTube
// /embed page is the guest's *top-level* document, so there is no cross-origin
// "embedder" for YouTube to validate — which is what fails (player error "152")
// when our app is loaded from file:// or a custom app:// scheme. The webview also
// has normal network access, so the player's own ad-status self-check succeeds.
//
// Seeking: rather than driving the YouTube IFrame API, we remount the webview at
// a new `start` second whenever the caller bumps `seek`. The `nonce` lets the
// same timestamp be re-clicked and still re-seek.

import { useEffect, useRef, useState } from 'react';

export interface SeekRequest {
  seconds: number;
  nonce: number;
}

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
  const autoplay = seek ? 1 : 0;
  const src =
    `https://www.youtube.com/embed/${videoId}` +
    `?start=${start}&autoplay=${autoplay}&rel=0&modestbranding=1`;
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // Remounting on seek re-navigates the webview to the new start second.
  const mountKey = `${videoId}:${seek?.nonce ?? 'init'}`;

  // Surface guest load failures so the user isn't left staring at a black box
  // (and can report the exact reason if playback still fails).
  useEffect(() => {
    setLoadError(null);
    const el = ref.current;
    if (!el) return;
    const onFail = (e: Event) => {
      const ev = e as unknown as { errorCode?: number; errorDescription?: string };
      // -3 is ERR_ABORTED, which fires on the normal remount/navigation; ignore.
      if (ev.errorCode === -3) return;
      setLoadError(ev.errorDescription || 'Could not load the player');
    };
    el.addEventListener('did-fail-load', onFail);
    return () => el.removeEventListener('did-fail-load', onFail);
  }, [mountKey]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-edge bg-black">
      <webview
        key={mountKey}
        ref={ref}
        src={src}
        className="h-full w-full"
        // Allow the player to start playing on seek without a fresh user gesture
        // in the guest (the gesture happened in our window, not the webview).
        webpreferences="autoplayPolicy=no-user-gesture-required"
      />
      {loadError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
          <p className="text-sm text-gray-300">Couldn&apos;t play in-app: {loadError}</p>
          <a
            href={watchUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Watch on YouTube
          </a>
        </div>
      )}
    </div>
  );
}
