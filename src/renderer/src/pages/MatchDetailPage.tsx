import { useEffect, useState } from 'react';
import type { Match, UploadJob } from '@shared/types';
import { YOUTUBE_PRIVACY_LABEL } from '@shared/types';
import { useMatch } from '../hooks/useMatch';
import { EventTimeline } from '../components/EventTimeline';
import { YoutubeEmbed, type SeekRequest } from '../components/YoutubeEmbed';

function fmtDuration(secs: number | null): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
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

  function seekTo(seconds: number) {
    setSeek((p) => ({ seconds, nonce: (p?.nonce ?? 0) + 1 }));
  }

  return (
    <div className="p-6">
      <button onClick={onBack} className="text-sm text-gray-400 hover:text-white">
        ← Back
      </button>

      <header className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            {m.champion ?? 'Unknown champ'}
            {m.result !== 'Unknown' && (
              <span className={`ml-3 text-lg ${m.result === 'Win' ? 'text-green-400' : 'text-red-400'}`}>
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
      </header>

      <div className="mt-5 grid grid-cols-2 gap-4 rounded-lg border border-edge bg-panel p-4 sm:grid-cols-4">
        <MetaRow label="Mode" value={m.gameMode ?? '—'} />
        <MetaRow label="Map" value={m.mapName ?? '—'} />
        <MetaRow label="Duration" value={fmtDuration(m.durationSeconds)} />
        <MetaRow label="Status" value={m.vodStatus} />
      </div>

      {videoId && (
        <div className="mt-4">
          <YoutubeEmbed videoId={videoId} seek={seek} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
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
        <p className="mt-2 text-xs text-gray-500">No recording file is on disk for this match.</p>
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
          <p className="text-sm text-green-400">Uploaded to YouTube ({YOUTUBE_PRIVACY_LABEL}).</p>
        ) : m.vodStatus === 'failed' ? (
          <div className="flex flex-col gap-2">
            {job?.lastError && <p className="text-sm text-red-400">Last error: {job.lastError}</p>}
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

      <h2 className="mb-1 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Timeline
      </h2>
      {videoId && (
        <p className="mb-1 text-xs text-gray-500">Click a moment to jump the video there.</p>
      )}
      <EventTimeline
        events={events}
        onSeek={videoId ? seekTo : undefined}
        offsetSeconds={offsetSeconds}
      />
    </div>
  );
}
