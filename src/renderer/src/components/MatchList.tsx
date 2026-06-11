import { useEffect, useState } from 'react';
import { CirclePlay, CloudUpload, Disc, Loader2, TriangleAlert } from 'lucide-react';
import type { Match } from '@shared/types';
import type { MatchHighlights } from '@shared/ipc-contract';
import { matchThumbUrl } from '../lib/championArt';
import { WinStreakCard } from './WinStreakCard';

function fmtDuration(secs: number | null): string {
  if (!secs || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const STATUS_CHIP: Record<string, { cls: string; icon?: React.ReactNode }> = {
  recording: { cls: 'bg-loss/20 text-loss-text', icon: <Disc size={10} /> },
  recorded: { cls: 'bg-primary/15 text-primary-dim', icon: <Disc size={10} /> },
  uploading: {
    cls: 'bg-yellow-500/15 text-yellow-300',
    icon: <Loader2 size={10} className="animate-spin" />,
  },
  uploaded: { cls: 'bg-win/15 text-win-text', icon: <CloudUpload size={10} /> },
  archived: { cls: 'bg-purple-500/15 text-purple-300', icon: <CloudUpload size={10} /> },
  deleted: { cls: 'bg-white/5 text-gray-400' },
  failed: { cls: 'bg-loss/25 text-loss-text', icon: <TriangleAlert size={10} /> },
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

const STREAK_LABEL: Record<number, string> = {
  2: 'Double Kill',
  3: 'Triple Kill',
  4: 'Quadra Kill',
  5: 'Pentakill',
};

// One gold "prestige" chip per card, only when real data backs it.
// Priority: biggest multikill > ace > first blood > flawless (0 deaths).
function highlightLabel(m: Match, h: MatchHighlights | undefined): string | null {
  if (h?.killStreak) return STREAK_LABEL[h.killStreak] ?? 'Multikill';
  if (h?.ace) return 'Ace';
  if (h?.firstBlood) return 'First Blood';
  if (m.deaths === 0 && m.kills + m.assists > 0) return 'Flawless';
  return null;
}

function MatchCard({
  m,
  highlight,
  onSelect,
}: {
  m: Match;
  highlight: MatchHighlights | undefined;
  onSelect: (id: string) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const thumb = matchThumbUrl(m);
  const showImg = thumb && !imgError;
  const win = m.result === 'Win';
  const loss = m.result === 'Lose';
  const status = STATUS_CHIP[m.vodStatus] ?? { cls: 'bg-white/5 text-gray-400' };
  const chip = highlightLabel(m, highlight);

  return (
    <button
      type="button"
      onClick={() => onSelect(m.id)}
      className={`glass-card group relative overflow-hidden text-left transition hover:-translate-y-0.5 ${
        win
          ? 'border-t-2 border-t-win hover:shadow-glow-win'
          : loss
            ? 'border-t-2 border-t-loss hover:shadow-glow-loss'
            : 'hover:border-gray-500'
      }`}
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
          <div className="flex h-full w-full items-center justify-center font-heading text-4xl font-bold text-gray-700">
            {(m.champion ?? '?').charAt(0)}
          </div>
        )}

        {/* Legibility gradient for the overlaid text. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />

        {(win || loss) && (
          <span className={`chip absolute left-2 top-2 ${win ? 'bg-win/90 text-white' : 'bg-loss/90 text-white'}`}>
            {win ? 'Victory' : 'Defeat'}
          </span>
        )}

        <span className={`chip absolute right-2 top-2 backdrop-blur-sm ${status.cls}`}>
          {status.icon}
          {m.vodStatus}
        </span>

        {m.youtubeUrl && (
          <span
            title="Watchable on YouTube"
            className="absolute bottom-2 right-2 rounded bg-black/70 p-1 text-loss-text"
          >
            <CirclePlay size={12} />
          </span>
        )}

        {/* Name + KDA overlaid on the art, like the mockup. */}
        <div className="absolute inset-x-3 bottom-2">
          <div className="truncate font-heading text-lg font-extrabold uppercase tracking-tight text-white">
            {m.champion ?? 'Unknown'}
          </div>
          <div className="font-heading text-sm font-bold tabular-nums text-gray-200">
            {m.kills} / {m.deaths} / {m.assists}
          </div>
        </div>
      </div>

      <div className="flex h-9 items-center justify-between gap-2 px-3">
        {chip ? (
          <span className="chip border border-gold/50 text-gold-bright">{chip}</span>
        ) : (
          <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">
            {fmtTime(m.recordingStartedAt)}
          </span>
        )}
        <span className="font-mono text-[11px] tabular-nums text-gray-400">
          {fmtDuration(m.durationSeconds)}
        </span>
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
  const [highlights, setHighlights] = useState<Record<string, MatchHighlights>>({});

  // One batched call for all visible cards (never per-card requests).
  useEffect(() => {
    if (matches.length === 0) return;
    let cancelled = false;
    void window.api.matches
      .getHighlights(matches.map((m) => m.id))
      .then((h) => {
        if (!cancelled) setHighlights(h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [matches]);

  if (matches.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-gray-500">
        No matches yet. Start a League game (or use Manual Start) to record one.
      </div>
    );
  }

  const groups = groupByDay(matches);

  return (
    <div className="relative px-6 py-5">
      {groups.map((g) => (
        <section key={g.key} className="mb-8">
          <div className="mb-3 flex items-baseline justify-between border-b border-edge pb-2">
            <h2 className="font-heading text-base font-bold uppercase tracking-tight text-white">
              {g.label}
            </h2>
            <span className="font-label text-[10px] uppercase tracking-widest text-gray-500">
              {g.items.length} {g.items.length === 1 ? 'match' : 'matches'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {g.items.map((m) => (
              <MatchCard key={m.id} m={m} highlight={highlights[m.id]} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ))}
      <WinStreakCard matches={matches} />
    </div>
  );
}
