import type Database from 'better-sqlite3';
import { safeStorage } from 'electron';
import type { ObsSettings } from '@shared/types';
import { DEFAULT_OBS_SETTINGS } from '@shared/types';
import { getDb } from '../db';
import { createLogger } from '../../../lib/logger';

const logger = createLogger('settings');

const KEY_OBS = 'obs'; // { host, port }
const KEY_OBS_PASSWORD = 'obs.password.enc'; // base64 of safeStorage-encrypted blob

export interface SettingsRepository {
  getRaw(key: string): unknown | null;
  setRaw(key: string, value: unknown): void;
  getObs(): ObsSettings;
  setObs(input: { host: string; port: number; password?: string }): void;
  hasObsPassword(): boolean;
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

  getObs(): ObsSettings {
    const base = (this.getRaw(KEY_OBS) as { host?: string; port?: number } | null) ?? {};
    return {
      host: base.host ?? DEFAULT_OBS_SETTINGS.host,
      port: base.port ?? DEFAULT_OBS_SETTINGS.port,
      password: this.readPassword(),
    };
  }

  setObs(input: { host: string; port: number; password?: string }): void {
    this.setRaw(KEY_OBS, { host: input.host, port: input.port });
    // Only overwrite the password when one is explicitly provided.
    if (input.password !== undefined) {
      this.writePassword(input.password);
    }
  }

  hasObsPassword(): boolean {
    return this.getRaw(KEY_OBS_PASSWORD) !== null;
  }

  private readPassword(): string {
    const stored = this.getRaw(KEY_OBS_PASSWORD) as string | null;
    if (!stored) return '';
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn('safeStorage unavailable; cannot decrypt OBS password');
      return '';
    }
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch (err) {
      logger.error('Failed to decrypt OBS password', err);
      return '';
    }
  }

  private writePassword(password: string): void {
    if (password === '') {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(KEY_OBS_PASSWORD);
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      logger.warn('safeStorage unavailable; storing OBS password is not possible securely');
      return;
    }
    const enc = safeStorage.encryptString(password).toString('base64');
    this.setRaw(KEY_OBS_PASSWORD, enc);
  }
}

let instance: SettingsRepository | null = null;
export function settingsRepository(): SettingsRepository {
  if (!instance) instance = new SqliteSettingsRepository(getDb());
  return instance;
}
