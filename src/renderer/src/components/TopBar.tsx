import { useEffect, useState } from 'react';
import { CircleDot, Square, TriangleAlert } from 'lucide-react';
import type { RecorderStatus } from '@shared/types';

function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Live elapsed-recording clock. Resolves the active match's recordingStartedAt
// once per recording session, then ticks locally every second.
function useRecordingElapsed(status: RecorderStatus | null): string | null {
  const [elapsed, setElapsed] = useState<string | null>(null);
  const inGame = status?.state === 'in_game';
  const matchId = status?.currentMatchId ?? null;

  useEffect(() => {
    if (!inGame || !matchId) {
      setElapsed(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    void window.api.matches.get(matchId).then((m) => {
      if (cancelled || !m) return;
      const startedAt = m.recordingStartedAt;
      const tick = () => setElapsed(fmtElapsed(Date.now() - startedAt));
      tick();
      timer = setInterval(tick, 1000);
    });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [inGame, matchId]);

  return elapsed;
}

const OBS_CHIP: Record<string, { cls: string; label: string }> = {
  connected: { cls: 'bg-win/15 text-win-text', label: 'OBS LIVE' },
  connecting: { cls: 'bg-yellow-500/15 text-yellow-300', label: 'OBS …' },
  disconnected: { cls: 'bg-loss/15 text-loss-text', label: 'OBS OFFLINE' },
};

export function TopBar({ status }: { status: RecorderStatus | null }) {
  const state = status?.state ?? 'idle';
  const obs = status?.obs ?? 'disconnected';
  const elapsed = useRecordingElapsed(status);
  const inGame = state === 'in_game';

  return (
    <header className="flex items-center justify-between border-b border-edge bg-panel/60 px-6 py-3 backdrop-blur-md">
      <h2 className="font-heading text-sm font-bold uppercase tracking-widest text-white">
        Command Center
      </h2>

      <div className="flex items-center gap-3">
        {status?.lastError && (
          <span title={status.lastError} className="text-loss-text">
            <TriangleAlert size={15} />
          </span>
        )}

        {inGame ? (
          <span className="chip bg-loss/15 text-loss-text">
            <span className="h-2 w-2 animate-pulse rounded-full bg-loss" />
            REC
            {elapsed && <span className="ml-1 font-mono text-xs tabular-nums">{elapsed}</span>}
          </span>
        ) : state === 'post_game' ? (
          <span className="chip bg-yellow-500/15 text-yellow-300">
            <span className="h-2 w-2 rounded-full bg-yellow-400" />
            Finalizing
          </span>
        ) : (
          <span className="chip bg-white/5 text-gray-400">
            <span className="h-2 w-2 rounded-full bg-gray-500" />
            Idle
          </span>
        )}

        <span className={`chip ${OBS_CHIP[obs].cls}`}>{OBS_CHIP[obs].label}</span>

        {inGame ? (
          <button
            onClick={() => void window.api.recorder.stopManual()}
            className="btn-danger flex items-center gap-2 !py-1.5"
          >
            <Square size={13} />
            Stop Recording
          </button>
        ) : (
          <button
            onClick={() => void window.api.recorder.startManual()}
            disabled={state === 'post_game'}
            className="btn-primary flex items-center gap-2 !py-1.5"
          >
            <CircleDot size={13} />
            Start Recording
          </button>
        )}
      </div>
    </header>
  );
}
