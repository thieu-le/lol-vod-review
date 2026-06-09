import { useState } from 'react';
import type { Match } from '@shared/types';
import { matchThumbUrl } from '../lib/championArt';

function fmtDuration(secs: number | null): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// "Today" / "Yesterday" / "Saturday, June 7, 2026" for the section header.
function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Group an already-descending-sorted match list into consecutive day buckets.
function groupByDay(matches: Match[]): { key: string; label: string; items: Match[] }[] {
  const groups: { key: string; label: string; items: Match[] }[] = [];
  for (const m of matches) {
    const key = dayKey(m.recordingStartedAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(m);
    else groups.push({ key, label: dayLabel(m.recordingStartedAt), items: [m] });
  }
  return groups;
}

function MatchCard({ m, onSelect }: { m: Match; onSelect: (id: string) => void }) {
  const [imgError, setImgError] = useState(false);
  const thumb = matchThumbUrl(m);
  const showImg = thumb && !imgError;
  const win = m.result === 'Win';
  const loss = m.result === 'Lose';

  return (
    <button
      type="button"
      onClick={() => onSelect(m.id)}
      className="group relative overflow-hidden rounded-lg border border-edge bg-panel text-left transition hover:border-gray-500"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-ink">
        {showImg ? (
          <img
            src={thumb}
            alt={m.champion ?? 'Match'}
            onError={() => setImgError(true)}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-gray-600">
            {(m.champion ?? '?').charAt(0)}
          </div>
        )}

        {/* Legibility gradient for the text overlaid on the art. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />

        {/* Win/loss accent stripe. */}
        {(win || loss) && (
          <span className={`absolute left-0 top-0 h-full w-1 ${win ? 'bg-green-500' : 'bg-red-500'}`} />
        )}

        {m.youtubeUrl && (
          <span
            title="Watchable on YouTube"
            className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-green-400"
          >
            ▶ YT
          </span>
        )}

        <span
          className={`absolute right-2 top-2 rounded px-2 py-0.5 text-[10px] font-medium ${
            STATUS_STYLE[m.vodStatus] ?? 'bg-gray-500/20 text-gray-300'
          }`}
        >
          {m.vodStatus}
        </span>

        <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-gray-200">
          {fmtDuration(m.durationSeconds)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-white">
            {m.champion ?? 'Unknown champ'}
            {(win || loss) && (
              <span className={`ml-1.5 text-xs ${win ? 'text-green-400' : 'text-red-400'}`}>
                {m.result}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500">{fmtTime(m.recordingStartedAt)}</div>
        </div>
        <div className="shrink-0 font-mono text-sm text-gray-300">
          {m.kills}/{m.deaths}/{m.assists}
        </div>
      </div>
    </button>
  );
}

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

  const groups = groupByDay(matches);

  return (
    <div className="px-6 py-4">
      {groups.map((g) => (
        <section key={g.key} className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {g.label}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {g.items.map((m) => (
              <MatchCard key={m.id} m={m} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
