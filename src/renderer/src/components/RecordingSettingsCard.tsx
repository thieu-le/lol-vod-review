import { useEffect, useState } from 'react';
import { History, Video } from 'lucide-react';
import { RETENTION_POLICY } from '@shared/types';
import type { RetentionPolicy } from '@shared/types';
import type { BackfillSummary } from '@shared/ipc-contract';
import { Toggle } from './Toggle';

const RETENTION_LABELS: Record<RetentionPolicy, string> = {
  'archive-then-delete-30d': 'Archive, then delete after 30 days',
  'delete-after-upload': 'Delete right after a successful upload',
  'keep-forever': 'Keep local recordings forever',
};

export function RecordingSettingsCard() {
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [summary, setSummary] = useState<BackfillSummary | null>(null);
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);
  const [rankedOnly, setRankedOnly] = useState<boolean | null>(null);

  useEffect(() => {
    void window.api.settings.getRetention().then(setPolicy);
    void window.api.settings.getLaunchAtLogin().then(setLaunchAtLogin);
    void window.api.settings.getRankedOnly().then(setRankedOnly);
  }, []);

  async function toggleRankedOnly(next: boolean) {
    const prev = rankedOnly;
    setRankedOnly(next);
    try {
      setRankedOnly(await window.api.settings.setRankedOnly(next));
    } catch {
      setRankedOnly(prev);
    }
  }

  async function toggleLaunch(next: boolean) {
    const prev = launchAtLogin;
    setLaunchAtLogin(next);
    try {
      setLaunchAtLogin(await window.api.settings.setLaunchAtLogin(next));
    } catch {
      setLaunchAtLogin(prev);
    }
  }

  async function change(next: RetentionPolicy) {
    setPolicy(next);
    setSaving(true);
    try {
      setPolicy(await window.api.settings.setRetention(next));
    } finally {
      setSaving(false);
    }
  }

  async function runBackfill() {
    setBackfilling(true);
    setSummary(null);
    try {
      setSummary(await window.api.maintenance.backfill());
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div className="glass-card p-5">
      <h2 className="card-title mb-4 flex items-center gap-2">
        <Video size={13} /> Recording Preferences
      </h2>

      <label className="field-label">
        Retention Policy
        <select
          value={policy ?? ''}
          disabled={policy === null || saving}
          onChange={(e) => void change(e.target.value as RetentionPolicy)}
          className="input disabled:opacity-50"
        >
          {RETENTION_POLICY.map((p) => (
            <option key={p} value={p}>
              {RETENTION_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-xs text-gray-500">
        Recordings are never deleted before a successful upload.
      </p>

      <div className="mt-4 flex flex-col gap-4 border-t border-edge pt-4">
        <Toggle
          checked={rankedOnly ?? false}
          disabled={rankedOnly === null}
          onChange={(next) => void toggleRankedOnly(next)}
          label="Ranked games only"
          description="Skips normals, ARAM, bots and customs. Detected via the League client, so the client must be running. If the queue can't be determined, the game is recorded so ranked is never missed."
        />
        <Toggle
          checked={launchAtLogin ?? false}
          disabled={launchAtLogin === null}
          onChange={(next) => void toggleLaunch(next)}
          label="Launch at login"
          description="Starts hidden in the system tray so games record automatically. Takes effect in the installed app (not in development)."
        />
      </div>

      <div className="mt-4 border-t border-edge pt-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-gray-200">Backfill old matches</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Re-process stored event snapshots to fill in champion, KDA and the timeline for
              older matches.
            </p>
          </div>
          <button
            onClick={runBackfill}
            disabled={backfilling}
            className="btn-ghost flex shrink-0 items-center gap-2 !py-1.5"
          >
            <History size={14} />
            {backfilling ? 'Backfilling…' : 'Backfill'}
          </button>
        </div>
        {summary && (
          <p className="mt-2 text-sm text-win-text">
            Processed {summary.matchesProcessed} match
            {summary.matchesProcessed === 1 ? '' : 'es'}, inserted {summary.eventsInserted} event
            {summary.eventsInserted === 1 ? '' : 's'}.
          </p>
        )}
      </div>
    </div>
  );
}
