import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CloudUpload,
  ExternalLink,
  FolderOpen,
  FolderSearch,
  Trash2,
} from 'lucide-react';
import type { Match, UploadJob } from '@shared/types';
import { YOUTUBE_PRIVACY_LABEL } from '@shared/types';
import { useMatch } from '../hooks/useMatch';
import { EventTimeline } from '../components/EventTimeline';
import { SeekerTimeline } from '../components/SeekerTimeline';
import { YoutubeEmbed, type SeekRequest } from '../components/YoutubeEmbed';
import { championLoadingUrl } from '../lib/championArt';

function fmtDuration(secs: number | null): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

// Labeled stat column for the header band (KDA / Duration / Map).
function HeaderStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-right">
      <div className="font-label text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className="font-heading text-xl font-bold tabular-nums text-white">{value}</div>
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
        className="h-16 w-16 shrink-0 rounded-full border-2 border-edge object-cover object-top"
      />
    );
  }
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-edge bg-raised font-heading text-2xl font-bold text-gray-600">
      {(champion ?? '?').charAt(0)}
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
        <button onClick={onBack} className="btn-ghost flex items-center gap-2 !px-3 !py-1.5">
          <ArrowLeft size={14} /> Back
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
  // Total recording length, for placing markers along the seeker.
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
      <button onClick={onBack} className="btn-ghost flex items-center gap-2 !px-3 !py-1.5">
        <ArrowLeft size={14} /> Back
      </button>

      {/* Header band: identity on the left, stat columns on the right. */}
      <header className="glass-card mt-4 flex flex-wrap items-center gap-5 px-5 py-4">
        <ChampionPortrait champion={m.champion} />
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate font-heading text-2xl font-extrabold uppercase tracking-tight text-white">
              {m.champion ?? 'Unknown'}
            </h1>
            {(win || loss) && (
              <span className={`chip ${win ? 'bg-win/90 text-white' : 'bg-loss/90 text-white'}`}>
                {win ? 'Victory' : 'Defeat'}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {fmtDate(m.recordingStartedAt)}
            {m.gameMode ? ` · ${m.gameMode}` : ''}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-8">
          <HeaderStat
            label="KDA Ratio"
            value={
              <>
                {m.kills} <span className="text-gray-600">/</span> {m.deaths}{' '}
                <span className="text-gray-600">/</span> {m.assists}
              </>
            }
          />
          <HeaderStat label="Duration" value={fmtDuration(m.durationSeconds)} />
          <HeaderStat label="Map" value={m.mapName ?? '—'} />
        </div>
      </header>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Player + seeker + actions + upload */}
        <div className="lg:col-span-2">
          {videoId && (
            <div className="flex flex-col gap-3">
              <YoutubeEmbed videoId={videoId} seek={seek} />
              <SeekerTimeline
                events={events}
                offsetSeconds={offsetSeconds}
                spanSeconds={recordingSpanSeconds}
                onSeek={seekTo}
              />
            </div>
          )}

          <div className={`flex flex-wrap items-center gap-3 ${videoId ? 'mt-4' : ''}`}>
            <button
              onClick={openVod}
              disabled={!hasVod}
              className="btn-ghost flex items-center gap-2 !py-1.5"
            >
              <FolderOpen size={14} /> Open Local File
            </button>
            <button
              onClick={revealVod}
              disabled={!hasVod}
              className="btn-ghost flex items-center gap-2 !py-1.5"
            >
              <FolderSearch size={14} /> Reveal in Folder
            </button>
            {m.youtubeUrl && (
              <a
                href={m.youtubeUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost flex items-center gap-2 !py-1.5"
              >
                <ExternalLink size={14} /> Open on YouTube
              </a>
            )}
            <div className="flex-1" />
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Delete this match?</span>
                <button onClick={doDelete} disabled={busy} className="btn-danger !py-1.5">
                  {busy ? 'Deleting…' : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                  className="btn-ghost !py-1.5"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 rounded-lg border border-loss/40 px-4 py-1.5 font-label text-sm uppercase tracking-wide text-loss-text transition hover:bg-loss/10"
              >
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>

          {vodError && <p className="mt-2 text-sm text-loss-text">{vodError}</p>}
          {!hasVod && (
            <p className="mt-2 text-xs text-gray-500">
              No recording file is on disk for this match.
            </p>
          )}

          <section className="glass-card mt-6 p-4">
            <h2 className="card-title mb-2 flex items-center gap-2">
              <CloudUpload size={13} /> YouTube Upload
            </h2>
            {m.vodStatus === 'uploading' || progress !== null ? (
              <div>
                <div className="mb-1 text-xs text-gray-400">Uploading… {progress ?? 0}%</div>
                <div className="h-2 w-full overflow-hidden rounded bg-raised">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${progress ?? 0}%` }}
                  />
                </div>
              </div>
            ) : m.vodStatus === 'uploaded' || m.vodStatus === 'archived' ? (
              <p className="text-sm text-win-text">
                Uploaded to YouTube ({YOUTUBE_PRIVACY_LABEL}).
              </p>
            ) : m.vodStatus === 'failed' ? (
              <div className="flex flex-col gap-2">
                {job?.lastError && (
                  <p className="text-sm text-loss-text">Last error: {job.lastError}</p>
                )}
                <button
                  onClick={retryUpload}
                  disabled={!hasVod}
                  className="btn-danger self-start !py-1.5"
                >
                  Retry upload
                </button>
              </div>
            ) : (
              <button onClick={uploadNow} disabled={!hasVod} className="btn-primary !py-1.5">
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
          <div className="glass-card p-4">
            <h2 className="card-title mb-1">Key Moments</h2>
            {videoId && (
              <p className="mb-2 text-xs text-gray-500">Click a moment to jump the video there.</p>
            )}
            <div className="max-h-[30rem] overflow-y-auto pr-1">
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
