/**
 * league-event-dumper (Phase 0)
 *
 * Standalone Riot Live Client logger. Polls /eventdata + /allgamedata and
 * appends every observation as JSONL to disk, with wall-clock + in-game time.
 * Run it across the game-mode matrix (Practice Tool, Normal, Ranked, ARAM,
 * Remake, Reconnect, Spectator, Custom) to learn the real event behavior
 * BEFORE the recorder relies on it.
 *
 * Usage:  npm run dump            -> writes ./live-events.jsonl
 *         npm run dump -- out.jsonl
 *
 * No Electron dependency: types below are imported type-only (erased at runtime).
 */
import https from 'node:https';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LiveAllGameData, LiveEvent } from '../../src/main/services/riot/liveClient';

const BASE = { host: '127.0.0.1', port: 2999 };
const POLL_MS = 1000;
const outFile = resolve(process.argv[2] ?? 'live-events.jsonl');

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function get<T>(path: string): Promise<T> {
  return new Promise((res, rej) => {
    const req = https.request(
      { host: BASE.host, port: BASE.port, path: `/liveclientdata${path}`, agent, timeout: 2000 },
      (r) => {
        const chunks: Buffer[] = [];
        r.on('data', (c) => chunks.push(c as Buffer));
        r.on('end', () => {
          if ((r.statusCode ?? 0) >= 300) return rej(new Error(`HTTP ${r.statusCode}`));
          try {
            res(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
          } catch (e) {
            rej(e);
          }
        });
      }
    );
    req.on('error', rej);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function write(record: unknown): void {
  appendFileSync(outFile, JSON.stringify(record) + '\n', 'utf8');
}

const seenEventIds = new Set<number>();
let wasActive = false;

async function tick(): Promise<void> {
  try {
    const all = await get<LiveAllGameData>('/allgamedata');
    if (!wasActive) {
      wasActive = true;
      console.log('Game detected — logging events to', outFile);
      write({ kind: 'session_start', wallClock: Date.now(), gameData: all.gameData });
    }

    const events: LiveEvent[] = all.events?.Events ?? [];
    for (const ev of events) {
      if (seenEventIds.has(ev.EventID)) continue;
      seenEventIds.add(ev.EventID);
      write({ kind: 'event', wallClock: Date.now(), event: ev });
      console.log(`[${ev.EventTime.toFixed(1)}s] ${ev.EventName}`, ev.VictimName ?? '');
    }
  } catch {
    if (wasActive) {
      wasActive = false;
      seenEventIds.clear();
      console.log('Game ended.');
      write({ kind: 'session_end', wallClock: Date.now() });
    }
  }
}

console.log('league-event-dumper running. Waiting for a League game…');
console.log('Output:', outFile);
setInterval(() => void tick(), POLL_MS);
