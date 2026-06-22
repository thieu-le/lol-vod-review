// Classifies match events from the active player's point of view, so the VOD
// timeline can show "what *I* did" (kills / assists / deaths) instead of every
// event in the game.
//
// Attribution uses the player's stored identity strings (riotId / game name /
// summoner name), captured live during a game and backfilled for old matches.
// Mirrors the main-process KDA logic in services/riot/eventParser.ts.

import type { MatchEvent } from '@shared/types';

export type Kad = 'kill' | 'death' | 'assist';

export const KAD_HEX: Record<Kad, string> = {
  kill: '#4ade80', // green
  assist: '#4cd6ff', // blue
  death: '#f87171', // red
};

export const KAD_LABEL: Record<Kad, string> = {
  kill: 'Kill',
  assist: 'Assist',
  death: 'Death',
};

// What the player did in a ChampionKill, or null if the event isn't personal
// (an objective, or another player's kill). Only ChampionKill carries K/A/D.
export function classifyKad(e: MatchEvent, identities: Set<string>): Kad | null {
  if (e.eventType !== 'ChampionKill') return null;
  if (e.killerName && identities.has(e.killerName)) return 'kill';
  if (e.victimName && identities.has(e.victimName)) return 'death';
  if (e.assisters.some((a) => identities.has(a))) return 'assist';
  return null;
}

export interface PersonalMarker {
  id: string;
  kind: Kad;
  recSeconds: number; // position within the recording (offset + in-game time)
  gameSeconds: number; // in-game time, for mm:ss labels
}

// The player's K/A/D events in chronological order. Empty when the player's
// identity isn't known yet (e.g. an old match that hasn't been backfilled).
export function personalMarkers(
  events: MatchEvent[],
  identities: string[],
  offsetSeconds: number
): PersonalMarker[] {
  if (identities.length === 0) return [];
  const ids = new Set(identities);
  const out: PersonalMarker[] = [];
  for (const e of events) {
    const kind = classifyKad(e, ids);
    if (!kind) continue;
    out.push({
      id: e.id,
      kind,
      recSeconds: offsetSeconds + e.eventTimeSeconds,
      gameSeconds: e.eventTimeSeconds,
    });
  }
  return out;
}
