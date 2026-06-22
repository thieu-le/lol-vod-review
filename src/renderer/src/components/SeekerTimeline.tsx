import type { MatchEvent } from '@shared/types';
import { describeEvent } from './EventTimeline';
import { KAD_HEX, KAD_LABEL, personalMarkers, type Kad } from '../lib/playerEvents';

// Personal VOD timeline: a horizontal track of the player's own kills, assists
// and deaths, positioned over the recording. Clicking a marker seeks the player.
// Falls back to showing all game events when the player's identity isn't known
// (an old match recorded before identity capture / not yet backfilled).

function fmtClock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Fallback colours by event category (used only when K/A/D can't be attributed).
function markerColor(t: string): string {
  if (t === 'BaronKill' || t === 'DragonKill' || t === 'HeraldKill' || t === 'AtakhanKill')
    return 'bg-purple-400';
  if (t === 'ChampionKill' || t === 'FirstBlood' || t === 'Multikill' || t === 'Ace')
    return 'bg-gold-bright';
  if (t === 'TurretKilled' || t === 'InhibKilled') return 'bg-primary-dim';
  return 'bg-gray-500';
}

function LegendDot({ kind }: { kind: Kad }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: KAD_HEX[kind] }} />
      <span className="font-label text-[10px] uppercase tracking-widest text-gray-400">
        {KAD_LABEL[kind]}
      </span>
    </span>
  );
}

export function SeekerTimeline({
  events,
  identities,
  offsetSeconds,
  spanSeconds,
  onSeek,
}: {
  events: MatchEvent[];
  // Active player's identity strings — drives K/A/D attribution.
  identities: string[];
  // Pre-game recording buffer added to each event's game time.
  offsetSeconds: number;
  // Total recording length the track represents.
  spanSeconds: number;
  onSeek: (recordingSeconds: number) => void;
}) {
  if (spanSeconds <= 0) return null;

  const personal = personalMarkers(events, identities, offsetSeconds);
  const showKad = personal.length > 0;

  return (
    <div className="glass-card px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-label text-[10px] uppercase tracking-widest text-gray-400">
          {showKad ? 'Your Timeline' : 'Match Timeline'}
        </span>
        {showKad ? (
          <div className="flex items-center gap-3">
            <LegendDot kind="kill" />
            <LegendDot kind="assist" />
            <LegendDot kind="death" />
          </div>
        ) : (
          <span className="font-label text-[10px] uppercase tracking-widest text-gray-600">
            Click a marker to jump
          </span>
        )}
      </div>

      <div className="relative h-7">
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/10" />

        {showKad
          ? personal.map((m) => {
              const pct = Math.min(100, Math.max(0, (m.recSeconds / spanSeconds) * 100));
              return (
                <button
                  key={m.id}
                  type="button"
                  title={`${fmtClock(m.gameSeconds)} · ${KAD_LABEL[m.kind]}`}
                  onClick={() => onSeek(m.recSeconds)}
                  style={{ left: `${pct}%`, background: KAD_HEX[m.kind] }}
                  className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-90 transition hover:h-5 hover:opacity-100 hover:shadow-glow-primary"
                />
              );
            })
          : events.map((e) => {
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
