import https from 'node:https';
import { config } from '../../lib/config';
import { createLogger } from '../../lib/logger';

const logger = createLogger('riot');

// ---- Live Client API response shapes (only fields we use) ----

export interface LiveEvent {
  EventID: number;
  EventName: string;
  EventTime: number; // seconds since game start
  // Optional fields depending on EventName:
  KillerName?: string;
  VictimName?: string;
  Assisters?: string[];
  Result?: string; // GameEnd: 'Win' | 'Lose'
  [key: string]: unknown;
}

export interface LiveActivePlayer {
  summonerName?: string;
  riotIdGameName?: string;
  riotId?: string;
}

export interface LivePlayer {
  championName?: string;
  summonerName?: string;
  riotId?: string;
  riotIdGameName?: string;
  isBot?: boolean;
}

export interface LiveGameStats {
  gameMode?: string;
  gameTime?: number;
  mapName?: string;
  mapNumber?: number;
}

export interface LiveAllGameData {
  activePlayer?: LiveActivePlayer;
  allPlayers?: LivePlayer[];
  events?: { Events?: LiveEvent[] };
  gameData?: LiveGameStats;
}

// Resolves the local player's champion by matching the active player's
// identity (riotId / riotIdGameName / summonerName) against allPlayers.
export function resolveActiveChampion(all: LiveAllGameData): string | null {
  const players = all.allPlayers ?? [];
  const ap = all.activePlayer;
  if (!ap || players.length === 0) return null;

  const keys = [ap.riotId, ap.riotIdGameName, ap.summonerName].filter(Boolean);
  const match = players.find(
    (p) =>
      (p.riotId && keys.includes(p.riotId)) ||
      (p.riotIdGameName && keys.includes(p.riotIdGameName)) ||
      (p.summonerName && keys.includes(p.summonerName))
  );
  return match?.championName ?? null;
}

// Dedicated agent: TLS verification disabled, scoped strictly to the
// localhost Live Client endpoint. Riot serves a self-signed cert on :2999.
const agent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});

class RiotUnavailableError extends Error {}

function get<T>(path: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      {
        host: config.riot.host,
        port: config.riot.port,
        path: `/liveclientdata${path}`,
        method: 'GET',
        agent,
        timeout: config.riot.requestTimeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString('utf8');
          if (status < 200 || status >= 300) {
            reject(new RiotUnavailableError(`HTTP ${status}`));
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', (err) => reject(new RiotUnavailableError(err.message)));
    req.on('timeout', () => {
      req.destroy(new RiotUnavailableError('timeout'));
    });
    req.end();
  });
}

export class RiotLiveClient {
  // True only while an actual game is in progress (API is up on :2999).
  async isGameActive(): Promise<boolean> {
    try {
      await get<unknown>('/gamestats');
      return true;
    } catch (err) {
      if (!(err instanceof RiotUnavailableError)) {
        logger.debug('isGameActive unexpected error', err);
      }
      return false;
    }
  }

  async getAllGameData(): Promise<LiveAllGameData | null> {
    try {
      return await get<LiveAllGameData>('/allgamedata');
    } catch {
      return null;
    }
  }

  async getEventData(): Promise<LiveEvent[]> {
    try {
      const data = await get<{ Events?: LiveEvent[] }>('/eventdata');
      return data.Events ?? [];
    } catch {
      return [];
    }
  }

  async getActivePlayerName(): Promise<string | null> {
    try {
      // Returns a bare JSON string, e.g. "Faker#KR1".
      return await get<string>('/activeplayername');
    } catch {
      return null;
    }
  }
}

export const riotLiveClient = new RiotLiveClient();
