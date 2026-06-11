import {
  Castle,
  Crown,
  Droplets,
  Flag,
  FlagOff,
  Flame,
  Play,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Zap,
} from 'lucide-react';
import type { MatchEvent } from '@shared/types';

function fmtGameTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Human label for an event row. Objective/kill events read off killer/victim.
export function describeEvent(e: MatchEvent): string {
  switch (e.eventType) {
    case 'ChampionKill':
      return `${e.killerName ?? 'Someone'} killed ${e.victimName ?? 'someone'}${
        e.assisters.length ? ` (+${e.assisters.length})` : ''
      }`;
    case 'TurretKilled':
      return `Turret destroyed${e.killerName ? ` by ${e.killerName}` : ''}`;
    case 'InhibKilled':
      return `Inhibitor destroyed${e.killerName ? ` by ${e.killerName}` : ''}`;
    case 'DragonKill':
      return `Dragon slain${e.killerName ? ` by ${e.killerName}` : ''}`;
    case 'BaronKill':
      return `Baron slain${e.killerName ? ` by ${e.killerName}` : ''}`;
    case 'HeraldKill':
      return `Rift Herald slain${e.killerName ? ` by ${e.killerName}` : ''}`;
    case 'AtakhanKill':
      return `Atakhan slain${e.killerName ? ` by ${e.killerName}` : ''}`;
    case 'FirstBlood':
      return 'First Blood';
    case 'Multikill':
      return `Multikill${e.killerName ? ` by ${e.killerName}` : ''}`;
    case 'Ace':
      return 'Ace';
    case 'GameStart':
      return 'Game start';
    case 'GameEnd':
      return 'Game end';
    default:
      return e.eventType;
  }
}

const EVENT_ICON: Record<string, React.ReactNode> = {
  ChampionKill: <Swords size={13} />,
  FirstBlood: <Droplets size={13} />,
  Multikill: <Zap size={13} />,
  Ace: <Sparkles size={13} />,
  TurretKilled: <Castle size={13} />,
  InhibKilled: <Shield size={13} />,
  DragonKill: <Flame size={13} />,
  BaronKill: <Crown size={13} />,
  HeraldKill: <Skull size={13} />,
  AtakhanKill: <Skull size={13} />,
  GameStart: <Flag size={13} />,
  GameEnd: <FlagOff size={13} />,
};

export function EventTimeline({
  events,
  onSeek,
  offsetSeconds = 0,
}: {
  events: MatchEvent[];
  // When provided, each row becomes a button that jumps the embedded VOD to the
  // moment. `offsetSeconds` is the pre-game recording buffer added to each event's
  // game-relative time to get its position in the recording.
  onSeek?: (recordingSeconds: number) => void;
  offsetSeconds?: number;
}) {
  if (events.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-500">
        No parsed events for this match yet.
      </div>
    );
  }

  const Row = ({ e }: { e: MatchEvent }) => (
    <>
      <span className="w-12 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums text-primary-dim">
        {fmtGameTime(e.eventTimeSeconds)}
      </span>
      <span className="min-w-0 flex-1 truncate text-gray-300 group-hover:text-white">
        {describeEvent(e)}
      </span>
      <span className="shrink-0 text-gray-600 group-hover:text-primary">
        {EVENT_ICON[e.eventType] ?? <Play size={13} />}
      </span>
    </>
  );

  return (
    <ul className="divide-y divide-edge">
      {events.map((e) =>
        onSeek ? (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onSeek(offsetSeconds + e.eventTimeSeconds)}
              className="group flex w-full items-center gap-3 rounded px-1 py-2 text-left text-sm transition hover:bg-white/5"
            >
              <Row e={e} />
            </button>
          </li>
        ) : (
          <li key={e.id} className="group flex items-center gap-3 px-1 py-2 text-sm">
            <Row e={e} />
          </li>
        )
      )}
    </ul>
  );
}
