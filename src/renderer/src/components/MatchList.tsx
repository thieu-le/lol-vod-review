import type { Match } from '@shared/types';

function fmtDuration(secs: number | null): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

const STATUS_STYLE: Record<string, string> = {
  recording: 'bg-red-500/20 text-red-300',
  recorded: 'bg-blue-500/20 text-blue-300',
  uploading: 'bg-yellow-500/20 text-yellow-300',
  uploaded: 'bg-green-500/20 text-green-300',
  archived: 'bg-purple-500/20 text-purple-300',
  deleted: 'bg-gray-500/20 text-gray-300',
  failed: 'bg-red-700/30 text-red-300',
};

export function MatchList({
  matches,
  onSelect,
}: {
  matches: Match[];
  onSelect: (id: string) => void;
}) {
  if (matches.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-gray-500">
        No matches yet. Start a League game (or use Manual Start) to record one.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-edge">
      {matches.map((m) => (
        <li
          key={m.id}
          onClick={() => onSelect(m.id)}
          className="flex cursor-pointer items-center justify-between px-6 py-3 hover:bg-panel/60"
        >
          <div className="flex flex-col">
            <span className="font-medium text-white">
              {m.champion ?? 'Unknown champ'}
              {m.result !== 'Unknown' && (
                <span
                  className={`ml-2 ${m.result === 'Win' ? 'text-green-400' : 'text-red-400'}`}
                >
                  {m.result}
                </span>
              )}
            </span>
            <span className="text-xs text-gray-500">{fmtDate(m.recordingStartedAt)}</span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            <span className="text-gray-400">
              {m.kills}/{m.deaths}/{m.assists}
            </span>
            <span className="text-gray-400">{fmtDuration(m.durationSeconds)}</span>
            {m.youtubeUrl && (
              <span title="Watchable on YouTube" className="text-xs text-green-400">
                ▶
              </span>
            )}
            <span
              className={`rounded px-2 py-0.5 text-xs ${
                STATUS_STYLE[m.vodStatus] ?? 'bg-gray-500/20 text-gray-300'
              }`}
            >
              {m.vodStatus}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
