import type Database from 'better-sqlite3';
import { safeStorage } from 'electron';
import type { InsightsSettings, RetentionPolicy, UploadMode } from '@shared/types';
import {
  DEFAULT_RETENTION_POLICY,
  DEFAULT_UPLOAD_MODE,
  RETENTION_POLICY,
  UPLOAD_MODE,
} from '@shared/types';
import { getDb } from '../db';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('settings');

const KEY_INSIGHTS = 'insights'; // { videoDir, dbPath }
const KEY_INSIGHTS_SEEDED = 'insights.seededFolders'; // string[]: folders whose backlog is marked
const KEY_RETENTION = 'retention'; // RetentionPolicy string
const KEY_YT = 'youtube'; // { clientId }
const KEY_YT_SECRET = 'youtube.secret.enc'; // encrypted OAuth client secret
const KEY_YT_TOKEN = 'youtube.token.enc'; // encrypted OAuth refresh token
const KEY_UPLOAD_MODE = 'uploadMode'; // UploadMode string
const KEY_LAUNCH_AT_LOGIN = 'launchAtLogin'; // boolean
const KEY_RANKED_ONLY = 'rankedOnly'; // boolean

// Default off: record every game. Users who only care about ranked opt in.
const DEFAULT_RANKED_ONLY = false;

// New installs default to launching at login so the recorder is running in the
// background before a game starts (matches the "set it and forget it" intent).
const DEFAULT_LAUNCH_AT_LOGIN = true;

export interface YoutubeConfig {
  clientId: string;
  clientSecret: string;
}

export interface SettingsRepository {
  getRaw(key: string): unknown | null;
  setRaw(key: string, value: unknown): void;
  getInsights(): InsightsSettings;
  setInsights(input: InsightsSettings): void;
  isInsightsFolderSeeded(folder: string): boolean;
  markInsightsFolderSeeded(folder: string): void;
  getRetention(): RetentionPolicy;
  setRetention(policy: RetentionPolicy): void;
  getUploadMode(): UploadMode;
  setUploadMode(mode: UploadMode): void;
  getLaunchAtLogin(): boolean;
  setLaunchAtLogin(enabled: boolean): void;
  getRankedOnly(): boolean;
  setRankedOnly(enabled: boolean): void;
  getYoutubeConfig(): YoutubeConfig;
  setYoutubeConfig(input: { clientId: string; clientSecret?: string }): void;
  hasYoutubeSecret(): boolean;
  getYoutubeRefreshToken(): string | null;
  setYoutubeRefreshToken(token: string | null): void;
}

function folderKey(folder: string): string {
  const k = folder.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? k.replace(/\//g, '\\').toLowerCase() : k;
}

class SqliteSettingsRepository implements SettingsRepository {
  constructor(private readonly db: Database.Database) {}

  getRaw(key: string): unknown | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }

  setRaw(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, JSON.stringify(value));
  }

  getInsights(): InsightsSettings {
    const v = (this.getRaw(KEY_INSIGHTS) as Partial<InsightsSettings> | null) ?? {};
    return {
      videoDir: typeof v.videoDir === 'string' ? v.videoDir : '',
      dbPath: typeof v.dbPath === 'string' ? v.dbPath : '',
    };
  }

  setInsights(input: InsightsSettings): void {
    this.setRaw(KEY_INSIGHTS, { videoDir: input.videoDir.trim(), dbPath: input.dbPath.trim() });
  }

  // Seeding is per folder: pointing the app at a different folder must not
  // treat that folder's existing recordings as new uploads.
  isInsightsFolderSeeded(folder: string): boolean {
    const v = this.getRaw(KEY_INSIGHTS_SEEDED);
    return Array.isArray(v) && v.includes(folderKey(folder));
  }

  markInsightsFolderSeeded(folder: string): void {
    const v = this.getRaw(KEY_INSIGHTS_SEEDED);
    const list = Array.isArray(v) ? (v as string[]) : [];
    if (!list.includes(folderKey(folder))) this.setRaw(KEY_INSIGHTS_SEEDED, [...list, folderKey(folder)]);
  }

  getRetention(): RetentionPolicy {
    const v = this.getRaw(KEY_RETENTION);
    return RETENTION_POLICY.includes(v as RetentionPolicy)
      ? (v as RetentionPolicy)
      : DEFAULT_RETENTION_POLICY;
  }

  setRetention(policy: RetentionPolicy): void {
    this.setRaw(KEY_RETENTION, policy);
  }

  getUploadMode(): UploadMode {
    const v = this.getRaw(KEY_UPLOAD_MODE);
    return UPLOAD_MODE.includes(v as UploadMode) ? (v as UploadMode) : DEFAULT_UPLOAD_MODE;
  }

  setUploadMode(mode: UploadMode): void {
    this.setRaw(KEY_UPLOAD_MODE, mode);
  }

  getLaunchAtLogin(): boolean {
    const v = this.getRaw(KEY_LAUNCH_AT_LOGIN);
    return typeof v === 'boolean' ? v : DEFAULT_LAUNCH_AT_LOGIN;
  }

  setLaunchAtLogin(enabled: boolean): void {
    this.setRaw(KEY_LAUNCH_AT_LOGIN, enabled);
  }

  getRankedOnly(): boolean {
    const v = this.getRaw(KEY_RANKED_ONLY);
    return typeof v === 'boolean' ? v : DEFAULT_RANKED_ONLY;
  }

  setRankedOnly(enabled: boolean): void {
    this.setRaw(KEY_RANKED_ONLY, enabled);
  }

  getYoutubeConfig(): YoutubeConfig {
    const base = (this.getRaw(KEY_YT) as { clientId?: string } | null) ?? {};
    return {
      clientId: base.clientId ?? '',
      clientSecret: this.readEncrypted(KEY_YT_SECRET),
    };
  }

  setYoutubeConfig(input: { clientId: string; clientSecret?: string }): void {
    this.setRaw(KEY_YT, { clientId: input.clientId });
    if (input.clientSecret !== undefined) {
      this.writeEncrypted(KEY_YT_SECRET, input.clientSecret);
    }
  }

  hasYoutubeSecret(): boolean {
    return this.getRaw(KEY_YT_SECRET) !== null;
  }

  getYoutubeRefreshToken(): string | null {
    const token = this.readEncrypted(KEY_YT_TOKEN);
    return token === '' ? null : token;
  }

  setYoutubeRefreshToken(token: string | null): void {
    this.writeEncrypted(KEY_YT_TOKEN, token ?? '');
  }

  // Generic secret storage: base64 of a safeStorage-encrypted blob, or '' when
  // unset. Secrets are never logged.
  private readEncrypted(key: string): string {
    const stored = this.getRaw(key) as string | null;
    if (!stored) return '';
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn(`safeStorage unavailable; cannot decrypt ${key}`);
      return '';
    }
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch (err) {
      logger.error(`Failed to decrypt ${key}`, err);
      return '';
    }
  }

  private writeEncrypted(key: string, value: string): void {
    if (value === '') {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn(`safeStorage unavailable; cannot securely store ${key}`);
      return;
    }
    const enc = safeStorage.encryptString(value).toString('base64');
    this.setRaw(key, enc);
  }
}

let instance: SettingsRepository | null = null;
export function settingsRepository(): SettingsRepository {
  if (!instance) instance = new SqliteSettingsRepository(getDb());
  return instance;
}
