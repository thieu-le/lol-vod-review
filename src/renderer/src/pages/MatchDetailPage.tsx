import { useEffect, useState } from 'react';
import type { Match, MatchEvent, UploadJob } from '@shared/types';
import { YOUTUBE_PRIVACY_LABEL } from '@shared/types';
import { useMatch } from '../hooks/useMatch';
import { EventTimeline } from '../components/EventTimeline';
import { YoutubeEmbed, type SeekRequest } from '../components/YoutubeEmbed';
import { championLoadingUrl } from '../lib/championArt';

function fmtDuration(secs: number | null): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtGameTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-sm text-gray-200">{value}</span>
    </div>
  );
}

// Champion portrait for the header; falls back to a lettered tile if Data Dragon
// has no art for the (possibly null/unknown) champion.
function ChampionPortrait({ champion }: { champion: string | null }) {
  const [err, setErr] = useState(false);
  if (champion && !err) {
    return (
      <img
        src={championLoadingUrl(champion)}
        alt={champion}
        onError={() => setErr(true)}
        className="h-20 w-16 shrink-0 rounded-md border border-edge object-cover object-top"
      />
    );
  }
  return (
    <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md border border-edge bg-panel text-2xl font-bold text-gray-600">
      {(champion ?? '?').charAt(0)}
    </div>
  );
}

// Colour markers by event category so the scrubber strip reads at a glance.
function markerColor(t: string): string {
  if (t === 'BaronKill' || t === 'DragonKill' || t === 'HeraldKill' || t === 'AtakhanKill')
    return 'bg-purple-400';
  if (t === 'ChampionKill' || t === 'FirstBlood' || t === 'Multikill' || t === 'Ace')
    return 'bg-amber-400';
  if (t === 'TurretKilled' || t === 'InhibKilled') return 'bg-sky-400';
  return 'bg-gray-400';
}

// Clickable event markers laid over a bar, positioned by each event's time
// within the recording. Clicking seeks the embed (remount-at-start).
function EventMarkers({
  events,
  offsetSeconds,
  spanSeconds,
  onSeek,
}: {
  events: MatchEvent[];
  offsetSeconds: number;
  spanSeconds: number;
  onSeek: (recordingSeconds: number) => void;
}) {
  if (spanSeconds <= 0 || events.length === 0) return null;
  return (
    <div className="relative mb-2 h-6 w-full rounded bg-ink">
      {events.map((e) => {
        const rec = offsetSeconds + e.eventTimeSeconds;
        const pct = Math.min(100, Math.max(0, (rec / spanSeconds) * 100));
        return (
          <button
            key={e.id}
            type="button"
            title={`${fmtGameTime(e.eventTimeSeconds)} · ${e.eventType}`}
            onClick={() => onSeek(rec)}
            style={{ left: `${pct}%` }}
            className={`absolute top-1 h-4 w-1 -translate-x-1/2 rounded-sm ${markerColor(
              e.eventType
            )} opacity-70 transition hover:h-5 hover:opacity-100`}
          />
        );
      })}
    </div>
  );
}

export function MatchDetailPage({
  matchId,
  onBack,
  onDeleted,
}: {
  matchId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { match, events, loading, refresh } = useMatch(matchId);
  const [vodError, setVodError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [job, setJob] = useState<UploadJob | null>(null);
  const [seek, setSeek] = useState<SeekRequest | null>(null);

  // Track upload progress + status for this match. onChanged fires whenever the
  // queue moves a job, so re-pull both the match row and its job.
  useEffect(() => {
    void window.api.uploads.getForMatch(matchId).then(setJob);
    const offProgress = window.api.uploads.onProgress((p) => {
      if (p.matchId === matchId) setProgress(p.pct);
    });
    const offChanged = window.api.uploads.onChanged(() => {
      void refresh();
      void window.api.uploads.getForMatch(matchId).then(setJob);
      setProgress(null);
    });
    return () => {
      offProgress();
      offChanged();
    };
  }, [matchId, refresh]);

  function uploadNow() {
    setProgress(0);
    void window.api.uploads.uploadNow(matchId);
  }

  function retryUpload() {
    setProgress(0);
    void window.api.uploads.retry(matchId);
  }

  async function openVod() {
    setVodError(null);
    const res = await window.api.vod.openLocal(matchId);
    if (!res.ok) setVodError(res.error ?? 'Could not open recording');
  }

  async function revealVod() {
    setVodError(null);
    const res = await window.api.vod.reveal(matchId);
    if (!res.ok) setVodError(res.error ?? 'Could not reveal recording');
  }

  async function doDelete() {
    setBusy(true);
    try {
      await window.api.matches.delete(matchId);
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  if (loading && !match) {
    return <div className="p-6 text-sm text-gray-500">Loading match…</div>;
  }

  if (!match) {
    return (
      <div className="p-6">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-white">
          ← Back
        </button>
        <p className="mt-4 text-sm text-gray-500">Match not found.</p>
      </div>
    );
  }

  const m: Match = match;
  const hasVod = Boolean(m.vodLocalPath);
  const videoId = m.youtubeVideoId;
  // Pre-game recording buffer: how far into the recording the game actually
  // started. Added to each event's game time to get its position in the VOD.
  const offsetSeconds = m.gameStartedAt
    ? Math.max(0, Math.round((m.gameStartedAt - m.recordingStartedAt) / 1000))
    : 0;
  // Total recording length, for placing markers along the scrubber.
  const recordingSpanSeconds = m.endedAt
    ? Math.max(1, Math.round((m.endedAt - m.recordingStartedAt) / 1000))
    : offsetSeconds + (m.durationSeconds ?? 0);

  function seekTo(seconds: number) {
    setSeek((p) => ({ seconds, nonce: (p?.nonce ?? 0) + 1 }));
  }

  const win = m.result === 'Win';
  const loss = m.result === 'Lose';

  return (
    <div className="p-6">
      <button onClick={onBack} className="text-sm text-gray-400 hover:text-white">
        ← Back
      </button>

      <header className="mt-4 flex items-start gap-4">
        <ChampionPortrait champion={m.champion} />
        <div className="flex flex-1 items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">
              {m.champion ?? 'Unknown champ'}
              {(win || loss) && (
                <span className={`ml-3 text-lg ${win ? 'text-green-400' : 'text-red-400'}`}>
                  {m.result}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-gray-500">{fmtDate(m.recordingStartedAt)}</p>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl text-white">
              {m.kills}/{m.deaths}/{m.assists}
            </div>
            <div className="text-xs uppercase tracking-wide text-gray-500">KDA</div>
          </div>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-4 rounded-lg border border-edge bg-panel p-4 sm:grid-cols-4">
        <MetaRow label="Mode" value={m.gameMode ?? '—'} />
        <MetaRow label="Map" value={m.mapName ?? '—'} />
        <MetaRow label="Duration" value={fmtDuration(m.durationSeconds)} />
        <MetaRow label="Status" value={m.vodStatus} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Player + actions + upload */}
        <div className="lg:col-span-2">
          {videoId && (
            <div className="mb-4">
              <EventMarkers
                events={events}
                offsetSeconds={offsetSeconds}
                spanSeconds={recordingSpanSeconds}
                onSeek={seekTo}
              />
              <YoutubeEmbed videoId={videoId} seek={seek} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={openVod}
              disabled={!hasVod}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              Open VOD
            </button>
            <button
              onClick={revealVod}
              disabled={!hasVod}
              className="rounded border border-edge px-3 py-1.5 text-sm text-white hover:bg-ink disabled:opacity-40"
            >
              Reveal in Folder
            </button>
            {m.youtubeUrl && (
              <a
                href={m.youtubeUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-edge px-3 py-1.5 text-sm text-white hover:bg-ink"
              >
                Open on YouTube
              </a>
            )}
            <div className="flex-1" />
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Delete this match?</span>
                <button
                  onClick={doDelete}
                  disabled={busy}
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
                >
                  {busy ? 'Deleting…' : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                  className="rounded border border-edge px-3 py-1.5 text-sm text-white hover:bg-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded border border-red-700/50 px-3 py-1.5 text-sm text-red-300 hover:bg-red-700/20"
              >
                Delete
              </button>
            )}
          </div>

          {vodError && <p className="mt-2 text-sm text-red-400">{vodError}</p>}
          {!hasVod && (
            <p className="mt-2 text-xs text-gray-500">
              No recording file is on disk for this match.
            </p>
          )}

          <section className="mt-6 rounded-lg border border-edge bg-panel p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400">
              YouTube Upload
            </h2>
            {m.vodStatus === 'uploading' || progress !== null ? (
              <div>
                <div className="mb-1 text-xs text-gray-400">Uploading… {progress ?? 0}%</div>
                <div className="h-2 w-full overflow-hidden rounded bg-ink">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${progress ?? 0}%` }}
                  />
                </div>
              </div>
            ) : m.vodStatus === 'uploaded' || m.vodStatus === 'archived' ? (
              <p className="text-sm text-green-400">
                Uploaded to YouTube ({YOUTUBE_PRIVACY_LABEL}).
              </p>
            ) : m.vodStatus === 'failed' ? (
              <div className="flex flex-col gap-2">
                {job?.lastError && (
                  <p className="text-sm text-red-400">Last error: {job.lastError}</p>
                )}
                <button
                  onClick={retryUpload}
                  disabled={!hasVod}
                  className="self-start rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
                >
                  Retry upload
                </button>
              </div>
            ) : (
              <button
                onClick={uploadNow}
                disabled={!hasVod}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
              >
                Upload to YouTube
              </button>
            )}
            {!hasVod && (
              <p className="mt-2 text-xs text-gray-500">A local recording is required to upload.</p>
            )}
          </section>
        </div>

        {/* Key moments rail */}
        <aside className="lg:col-span-1">
          <div className="rounded-lg border border-edge bg-panel p-4">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
              Key Moments
            </h2>
            {videoId && (
              <p className="mb-2 text-xs text-gray-500">Click a moment to jump the video there.</p>
            )}
            <div className="max-h-[28rem] overflow-y-auto pr-1">
              <EventTimeline
                events={events}
                onSeek={videoId ? seekTo : undefined}
                offsetSeconds={offsetSeconds}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
