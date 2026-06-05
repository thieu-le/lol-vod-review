// Embedded YouTube player for a match VOD. Videos are uploaded Unlisted, which
// (unlike Private) can be played in an embed without the viewer being signed in.
//
// Seeking: rather than loading the YouTube IFrame API script (which would force
// a broader CSP), we remount the iframe at a new `start` second whenever the
// caller bumps `seek`. The `nonce` lets the same timestamp be re-clicked and
// still re-seek. CSP only needs frame-src for the nocookie embed host.

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
  const start = seek ? Math.max(0, Math.floor(seek.seconds)) : 0;
  const autoplay = seek ? 1 : 0;
  const src =
    `https://www.youtube-nocookie.com/embed/${videoId}` +
    `?start=${start}&autoplay=${autoplay}&rel=0&modestbranding=1`;

  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg border border-edge bg-black">
      <iframe
        key={`${videoId}:${seek?.nonce ?? 'init'}`}
        src={src}
        title="Match VOD"
        className="h-full w-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    </div>
  );
}
