import type { MatchEvent } from '@shared/types';
import { describeEvent } from './EventTimeline';

// Insights-style seeker: a horizontal track spanning the whole recording with
// one clickable marker per event, positioned proportionally. Clicking seeks the
// embedded VOD via the same remount-at-start mechanism as the Key Moments rail.

function fmtClock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Colour markers by event category so the strip reads at a glance.
function markerColor(t: string): string {
  if (t === 'BaronKill' || t === 'DragonKill' || t === 'HeraldKill' || t === 'AtakhanKill')
    return 'bg-purple-400';
  if (t === 'ChampionKill' || t === 'FirstBlood' || t === 'Multikill' || t === 'Ace')
    return 'bg-gold-bright';
  if (t === 'TurretKilled' || t === 'InhibKilled') return 'bg-primary-dim';
  return 'bg-gray-500';
}

export function SeekerTimeline({
  events,
  offsetSeconds,
  spanSeconds,
  onSeek,
}: {
  events: MatchEvent[];
  // Pre-game recording buffer added to each event's game time.
  offsetSeconds: number;
  // Total recording length the track represents.
  spanSeconds: number;
  onSeek: (recordingSeconds: number) => void;
}) {
  if (spanSeconds <= 0 || events.length === 0) return null;

  return (
    <div className="glass-card px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-widest text-gray-400">
          Match Timeline
        </span>
        <span className="font-label text-[10px] uppercase tracking-widest text-gray-600">
          Click a marker to jump
        </span>
      </div>

      <div className="relative h-7">
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10" />
        {events.map((e) => {
          const rec = offsetSeconds + e.eventTimeSeconds;
          const pct = Math.min(100, Math.max(0, (rec / spanSeconds) * 100));
          return (
            <button
              key={e.id}
              type="button"
              title={`${fmtClock(e.eventTimeSeconds)} · ${describeEvent(e)}`}
              onClick={() => onSeek(rec)}
              style={{ left: `${pct}%` }}
              className={`absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${markerColor(
                e.eventType
              )} opacity-80 transition hover:h-5 hover:opacity-100 hover:shadow-glow-primary`}
            />
          );
        })}
      </div>

      <div className="mt-1 flex items-center justify-between font-mono text-[10px] tabular-nums text-gray-500">
        <span>0:00</span>
        <span>{fmtClock(spanSeconds)}</span>
      </div>
    </div>
  );
}
