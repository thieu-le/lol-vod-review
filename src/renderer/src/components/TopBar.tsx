import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
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

const INSIGHTS_CHIP: Record<string, { cls: string; label: string }> = {
  watching: { cls: 'bg-win/15 text-win-text', label: 'INSIGHTS' },
  folder_missing: { cls: 'bg-loss/15 text-loss-text', label: 'INSIGHTS FOLDER MISSING' },
};

// Recording is done by Insights Capture; this bar shows whether a League game
// is being tracked live and whether the Insights folder is being watched.
export function TopBar({ status }: { status: RecorderStatus | null }) {
  const state = status?.state ?? 'idle';
  const insights = status?.insights.state ?? 'folder_missing';
  const elapsed = useRecordingElapsed(status);
  const inGame = state === 'in_game';
  const chip = INSIGHTS_CHIP[insights] ?? INSIGHTS_CHIP.folder_missing;

  return (
    <header className="flex items-center justify-between border-b border-edge bg-panel/60 px-6 py-3 backdrop-blur-md">
      <h2 className="font-heading text-sm font-bold uppercase tracking-widest text-white">
        Command Center
      </h2>

      <div className="flex items-center gap-3">
        {(status?.lastError || status?.insights.lastError) && (
          <span
            title={status?.insights.lastError ?? status?.lastError ?? ''}
            className="text-loss-text"
          >
            <TriangleAlert size={15} />
          </span>
        )}

        {inGame ? (
          <span className="chip bg-loss/15 text-loss-text">
            <span className="h-2 w-2 animate-pulse rounded-full bg-loss" />
            IN GAME
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

        <span
          className={`chip ${chip.cls}`}
          title={status?.insights.videoDir ? `Watching ${status.insights.videoDir}` : undefined}
        >
          {chip.label}
        </span>
      </div>
    </header>
  );
}
