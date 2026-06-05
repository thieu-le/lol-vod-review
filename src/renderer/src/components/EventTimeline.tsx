import type { MatchEvent } from '@shared/types';

function fmtGameTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Human label for an event row. Objective/kill events read off killer/victim.
function describe(e: MatchEvent): string {
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

  return (
    <ul className="divide-y divide-edge">
      {events.map((e) =>
        onSeek ? (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onSeek(offsetSeconds + e.eventTimeSeconds)}
              className="group flex w-full items-center gap-4 px-1 py-2 text-left text-sm hover:bg-panel/60"
            >
              <span className="w-12 shrink-0 font-mono text-gray-500 group-hover:text-blue-400">
                {fmtGameTime(e.eventTimeSeconds)}
              </span>
              <span className="text-gray-300 group-hover:text-white">{describe(e)}</span>
              <span className="ml-auto text-xs text-transparent group-hover:text-blue-400">
                ▶ play
              </span>
            </button>
          </li>
        ) : (
          <li key={e.id} className="flex items-center gap-4 px-1 py-2 text-sm">
            <span className="w-12 shrink-0 font-mono text-gray-500">
              {fmtGameTime(e.eventTimeSeconds)}
            </span>
            <span className="text-gray-300">{describe(e)}</span>
          </li>
        )
      )}
    </ul>
  );
}
