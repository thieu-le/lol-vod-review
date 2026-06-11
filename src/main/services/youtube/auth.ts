import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { shell } from 'electron';
import { google } from 'googleapis';
import { AppError } from '../../lib/errors';
import { createLogger } from '../../lib/logger';
import { settingsRepository } from '../database/repositories/settingsRepository';

const logger = createLogger('youtube-auth');

// Upload-only scope keeps the consent surface minimal.
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

export type OAuthClient = InstanceType<typeof google.auth.OAuth2>;

export interface YoutubeAuthStatus {
  hasCredentials: boolean; // OAuth client id + secret configured
  connected: boolean; // a refresh token is stored
}

let activeServer: Server | null = null;

export function getAuthStatus(): YoutubeAuthStatus {
  const cfg = settingsRepository().getYoutubeConfig();
  return {
    hasCredentials: cfg.clientId !== '' && cfg.clientSecret !== '',
    connected: settingsRepository().getYoutubeRefreshToken() !== null,
  };
}

// Builds a client primed with the stored refresh token. googleapis transparently
// exchanges it for short-lived access tokens, so no access token is persisted.
export function getAuthorizedClient(): OAuthClient {
  const cfg = settingsRepository().getYoutubeConfig();
  if (cfg.clientId === '' || cfg.clientSecret === '') {
    throw new AppError('VALIDATION_ERROR', 'YouTube OAuth client is not configured');
  }
  const refreshToken = settingsRepository().getYoutubeRefreshToken();
  if (!refreshToken) {
    throw new AppError('VALIDATION_ERROR', 'YouTube account is not connected');
  }
  const client = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export function disconnect(): void {
  settingsRepository().setYoutubeRefreshToken(null);
  logger.info('YouTube account disconnected');
}

// Desktop loopback OAuth: spin up a localhost server, send the user to consent
// in their system browser, capture the redirected code, exchange for a refresh
// token, and store it encrypted. Resolves to the new status.
export async function connect(): Promise<YoutubeAuthStatus> {
  const cfg = settingsRepository().getYoutubeConfig();
  if (cfg.clientId === '' || cfg.clientSecret === '') {
    throw new AppError('VALIDATION_ERROR', 'Set the YouTube OAuth client ID and secret first');
  }
  if (activeServer) {
    throw new AppError('VALIDATION_ERROR', 'A YouTube connection is already in progress');
  }

  // The redirect URI is bound to the ephemeral port and MUST match at token
  // exchange, so capture it from the listen callback for reuse below.
  let redirectUri = '';

  const code = await new Promise<string>((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const err = url.searchParams.get('error');
      const authCode = url.searchParams.get('code');
      if (!err && !authCode) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body style="font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:2rem">' +
          '<h2>You can close this tab and return to Never Tilt Again.</h2></body></html>'
      );
      clearTimeout(timer);
      if (err) reject(new AppError('UNKNOWN', `YouTube authorization failed: ${err}`));
      else resolve(authCode as string);
    });

    server.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      redirectUri = `http://127.0.0.1:${port}`;
      const client = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, redirectUri);
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // force a refresh_token on every connect
        scope: SCOPES,
      });
      void shell.openExternal(authUrl);
    });

    activeServer = server;
    timer = setTimeout(() => {
      reject(new AppError('UNKNOWN', 'Timed out waiting for YouTube authorization'));
    }, CONNECT_TIMEOUT_MS);
    timer.unref();
  }).finally(() => {
    if (activeServer) {
      activeServer.close();
      activeServer = null;
    }
  });

  const client = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, redirectUri);
  const { tokens } = await client.getToken(code);
  if (tokens.refresh_token) {
    settingsRepository().setYoutubeRefreshToken(tokens.refresh_token);
    logger.info('YouTube account connected');
  } else if (!settingsRepository().getYoutubeRefreshToken()) {
    throw new AppError('UNKNOWN', 'Google did not return a refresh token; try reconnecting');
  }
  return getAuthStatus();
}
