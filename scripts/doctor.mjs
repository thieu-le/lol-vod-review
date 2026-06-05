#!/usr/bin/env node
// Environment preflight for LoL VOD Review. Runs under plain Node (no Electron,
// no build needed) so it works the moment the repo is cloned. Reports PASS /
// WARN / FAIL / INFO with a remediation hint for anything that isn't ready.
//
// Usage:  node scripts/doctor.mjs        (or: npm run doctor)
//         OBS_PORT=4456 npm run doctor    (override the OBS WebSocket port)

import net from 'node:net';
import https from 'node:https';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OBS_HOST = process.env.OBS_HOST ?? '127.0.0.1';
const OBS_PORT = Number(process.env.OBS_PORT ?? 4455);
const LIVE_CLIENT = 'https://127.0.0.1:2999/liveclientdata/gamestats';
const MIN_NODE_MAJOR = 18;

let fails = 0;
let warns = 0;

const TAG = {
  PASS: '\x1b[32mPASS\x1b[0m',
  WARN: '\x1b[33mWARN\x1b[0m',
  FAIL: '\x1b[31mFAIL\x1b[0m',
  INFO: '\x1b[36mINFO\x1b[0m',
};

function report(level, label, detail, hint) {
  if (level === 'FAIL') fails++;
  if (level === 'WARN') warns++;
  console.log(`  [${TAG[level]}] ${label}${detail ? ` — ${detail}` : ''}`);
  if (hint) console.log(`         ↳ ${hint}`);
}

// Plain TCP probe: does something accept a connection on host:port?
function tcpProbe(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done('open'));
    socket.once('timeout', () => done('timeout'));
    socket.once('error', (err) => done(err.code === 'ECONNREFUSED' ? 'refused' : 'error'));
    socket.connect(port, host);
  });
}

// The Live Client serves a self-signed cert on :2999, so we bypass TLS — scoped
// to this one request, exactly as the app does at runtime.
function liveClientProbe(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = https.get(LIVE_CLIENT, { rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200 ? 'in-game' : `http-${res.statusCode}`);
    });
    req.once('timeout', () => {
      req.destroy();
      resolve('timeout');
    });
    req.once('error', (err) => resolve(err.code === 'ECONNREFUSED' ? 'refused' : 'error'));
  });
}

async function main() {
  console.log('\nLoL VOD Review — environment check\n');

  // 1. Node version
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= MIN_NODE_MAJOR) {
    report('PASS', 'Node.js', `v${process.versions.node} on ${process.platform}/${process.arch}`);
  } else {
    report('FAIL', 'Node.js', `v${process.versions.node}`, `Install Node ${MIN_NODE_MAJOR}+ from https://nodejs.org`);
  }

  // 2. Dependencies installed
  if (existsSync(join(ROOT, 'node_modules'))) {
    report('PASS', 'Dependencies', 'node_modules present');
  } else {
    report('FAIL', 'Dependencies', 'node_modules missing', 'Run: npm install');
  }

  // 3. better-sqlite3 native binary rebuilt for Electron's ABI
  const sqliteBinary = join(ROOT, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  if (existsSync(sqliteBinary)) {
    report('PASS', 'Native module (better-sqlite3)', 'compiled binary present');
  } else {
    report(
      'FAIL',
      'Native module (better-sqlite3)',
      'compiled binary missing',
      process.platform === 'win32'
        ? 'Install "Desktop development with C++" (Visual Studio Build Tools), then: npm run rebuild'
        : 'Run: npm run rebuild',
    );
  }

  // 4. googleapis present (YouTube upload dependency)
  if (existsSync(join(ROOT, 'node_modules', 'googleapis'))) {
    report('PASS', 'googleapis', 'installed (YouTube upload available)');
  } else {
    report('WARN', 'googleapis', 'not installed', 'YouTube upload will be unavailable — run: npm install');
  }

  // 5. Production build output (only relevant for `npm start` / packaging)
  if (existsSync(join(ROOT, 'out', 'main', 'index.js'))) {
    report('INFO', 'Build output', 'out/ present (npm start / packaging ready)');
  } else {
    report('INFO', 'Build output', 'not built yet', 'For dev use `npm run dev`; to package run `npm run build`');
  }

  // 6. OBS WebSocket reachable
  const obs = await tcpProbe(OBS_HOST, OBS_PORT);
  if (obs === 'open') {
    report('PASS', 'OBS WebSocket', `listening on ${OBS_HOST}:${OBS_PORT}`);
  } else {
    report(
      'WARN',
      'OBS WebSocket',
      `${OBS_HOST}:${OBS_PORT} ${obs}`,
      'Open OBS → Tools → WebSocket Server Settings → Enable. Recording needs this. (Set OBS_PORT if you changed it.)',
    );
  }

  // 7. League Live Client (only meaningful while you're actually in a game)
  const live = await liveClientProbe();
  if (live === 'in-game') {
    report('PASS', 'League Live Client', 'in an active game on :2999');
  } else if (live === 'refused') {
    report('INFO', 'League Live Client', 'not in a game', 'Normal unless you are currently in a match. Start a game to verify detection.');
  } else {
    report('INFO', 'League Live Client', live, 'Only reachable during an active game.');
  }

  console.log('\nApp data (db, logs, archive) lives under your OS user-data dir:');
  console.log(
    process.platform === 'win32'
      ? '  %APPDATA%\\lol-vod-review'
      : process.platform === 'darwin'
        ? '  ~/Library/Application Support/lol-vod-review'
        : '  ~/.config/lol-vod-review',
  );
  console.log('Recordings are written wherever OBS is configured to record; the app reads that path back from OBS.\n');

  if (fails > 0) {
    console.log(`Result: ${fails} blocking issue(s)${warns ? `, ${warns} warning(s)` : ''}. Fix the FAIL items above.\n`);
    process.exit(1);
  }
  console.log(`Result: ready to run${warns ? ` (${warns} warning(s) — see WARN above)` : ''}. Start with: npm run dev\n`);
}

main();
