import https from 'node:https';
import { exec } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../lib/logger';

const logger = createLogger('lcu');

// The in-game Live Client API (:2999) exposes gameMode ("CLASSIC") but NOT the
// queue, so it can't tell ranked from normal Summoner's Rift. The League Client
// (LCU) API can: /lol-gameflow/v1/session carries the queue, including isRanked.
// This module discovers the running client's loopback credentials and reads it.

interface LcuCredentials {
  port: number;
  password: string; // remoting auth token; LCU uses HTTP Basic riot:<token>
}

// Preferred discovery: scrape the LeagueClientUx process command line, which
// carries --app-port and --remoting-auth-token regardless of which drive League
// is installed on. Falls back to the lockfile in common install dirs.
async function discover(): Promise<LcuCredentials | null> {
  const fromProcess = await fromProcessArgs();
  if (fromProcess) return fromProcess;
  return fromLockfile();
}

function fromProcessArgs(): Promise<LcuCredentials | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    const cmd =
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process ' +
      "-Filter \\\"name='LeagueClientUx.exe'\\\" | Select-Object -ExpandProperty CommandLine\"";
    exec(cmd, { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      const port = /--app-port=(\d+)/.exec(stdout)?.[1];
      const token = /--remoting-auth-token=([\w-]+)/.exec(stdout)?.[1];
      resolve(port && token ? { port: Number(port), password: token } : null);
    });
  });
}

// Default install locations; covers the common Windows path and macOS (dev).
const LOCKFILE_DIRS = [
  'C:\\Riot Games\\League of Legends',
  '/Applications/League of Legends.app/Contents/LoL',
];

function fromLockfile(): LcuCredentials | null {
  for (const dir of LOCKFILE_DIRS) {
    try {
      const raw = readFileSync(join(dir, 'lockfile'), 'utf8');
      const parts = raw.split(':'); // name:pid:port:password:protocol
      if (parts.length >= 5) return { port: Number(parts[2]), password: parts[3] };
    } catch {
      // try next location
    }
  }
  return null;
}

// Scoped TLS bypass: the LCU serves a self-signed cert on 127.0.0.1 only.
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

function get<T>(creds: LcuCredentials, path: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const auth = 'Basic ' + Buffer.from(`riot:${creds.password}`).toString('base64');
    const req = https.request(
      {
        host: '127.0.0.1',
        port: creds.port,
        path,
        method: 'GET',
        agent,
        timeout: 3000,
        headers: { Authorization: auth },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c as Buffer));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status}`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

export interface QueueInfo {
  isRanked: boolean;
  queueId: number | null;
}

interface GameflowSession {
  gameData?: { queue?: { id?: number; isRanked?: boolean; type?: string } };
}

class LcuClient {
  // Returns the current queue, or null if the League client API can't be reached
  // (not running, credentials not found, or request failed).
  async getCurrentQueue(): Promise<QueueInfo | null> {
    const creds = await discover();
    if (!creds) {
      logger.debug('LCU credentials not found (client not running?)');
      return null;
    }
    try {
      const session = await get<GameflowSession>(creds, '/lol-gameflow/v1/session');
      const q = session.gameData?.queue;
      if (!q) return null;
      return { isRanked: Boolean(q.isRanked), queueId: typeof q.id === 'number' ? q.id : null };
    } catch (err) {
      logger.debug('LCU gameflow query failed', err);
      return null;
    }
  }
}

export const lcuClient = new LcuClient();
