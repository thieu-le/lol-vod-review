import type { RiotEventType } from '@shared/types';
import { RIOT_EVENT_TYPES } from '@shared/types';
import type { LiveActivePlayer, LiveEvent } from './liveClient';

// Pure, I/O-free parsing of the Live Client event stream.
//
// Input is the raw `events.Events[]` from `getAllGameData()`. Output is a
// structured, deterministic `ParsedEvent[]` plus a KDA computation. No UUIDs,
// no matchId, no DB — persistence (id/matchId/wallClockAt/createdAt) is the
// event repository's job (backlog 2.2). Keeping this layer pure lets the same
// parser run live during a game and again over stored snapshots for backfill.

// One recognized event, normalized. `eventId` is Riot's stable EventID, kept so
// the repository can dedupe across overlapping polls.
export interface ParsedEvent {
  eventId: number;
  eventType: RiotEventType;
  eventTimeSeconds: number;
  killerName: string | null;
  victimName: string | null;
  assisters: string[];
  payload: LiveEvent; // verbatim raw event
}

export interface Kda {
  kills: number;
  deaths: number;
  assists: number;
}

const KNOWN_EVENT_TYPES = new Set<string>(RIOT_EVENT_TYPES);

// Riot kill events expose names under varying keys depending on EventName.
function readKiller(e: LiveEvent): string | null {
  const v = e.KillerName;
  return typeof v === 'string' ? v : null;
}

function readVictim(e: LiveEvent): string | null {
  const v = e.VictimName;
  return typeof v === 'string' ? v : null;
}

function readAssisters(e: LiveEvent): string[] {
  return Array.isArray(e.Assisters)
    ? e.Assisters.filter((a): a is string => typeof a === 'string')
    : [];
}

// Maps raw events → recognized ParsedEvents. Skips unknown EventNames and
// dedupes by EventID within this batch (defensive; cross-poll dedupe is 2.2).
export function parseEvents(raw: LiveEvent[]): ParsedEvent[] {
  const seen = new Set<number>();
  const out: ParsedEvent[] = [];

  for (const e of raw) {
    if (!KNOWN_EVENT_TYPES.has(e.EventName)) continue;
    if (typeof e.EventID !== 'number' || seen.has(e.EventID)) continue;
    seen.add(e.EventID);

    out.push({
      eventId: e.EventID,
      eventType: e.EventName as RiotEventType,
      eventTimeSeconds: typeof e.EventTime === 'number' ? e.EventTime : 0,
      killerName: readKiller(e),
      victimName: readVictim(e),
      assisters: readAssisters(e),
      payload: e,
    });
  }

  return out;
}

// Identity strings that can refer to the local player across event payloads
// (riotId / riotIdGameName / summonerName), mirroring resolveActiveChampion.
export function activePlayerIdentities(ap: LiveActivePlayer | undefined): string[] {
  if (!ap) return [];
  return [ap.riotId, ap.riotIdGameName, ap.summonerName].filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  );
}

function isActivePlayer(name: string | null, identities: Set<string>): boolean {
  return name !== null && identities.has(name);
}

// Active-player KDA, computed solely from ChampionKill events to avoid
// double-counting (Multikill/Ace/FirstBlood are derived signals, not kills).
// A death also counts when the active player is the victim.
export function computeKda(events: ParsedEvent[], identities: string[]): Kda {
  const ids = new Set(identities);
  let kills = 0;
  let deaths = 0;
  let assists = 0;

  for (const e of events) {
    if (e.eventType !== 'ChampionKill') continue;

    if (isActivePlayer(e.killerName, ids)) {
      kills += 1;
    } else if (isActivePlayer(e.victimName, ids)) {
      deaths += 1;
    } else if (e.assisters.some((a) => ids.has(a))) {
      assists += 1;
    }
  }

  return { kills, deaths, assists };
}
