import { useEffect, useState } from 'react';
import { RETENTION_POLICY } from '@shared/types';
import type { RetentionPolicy } from '@shared/types';
import type { BackfillSummary } from '@shared/ipc-contract';

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
    <div className="rounded-lg border border-edge bg-panel p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Recordings
      </h2>

      <label className="flex flex-col gap-1 text-xs text-gray-400">
        Local file retention
        <select
          value={policy ?? ''}
          disabled={policy === null || saving}
          onChange={(e) => void change(e.target.value as RetentionPolicy)}
          className="rounded border border-edge bg-ink px-2 py-1 text-sm text-white disabled:opacity-50"
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

      <div className="mt-4 border-t border-edge pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">What to record</h3>
        <label className="mt-2 flex items-center gap-2 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={rankedOnly ?? false}
            disabled={rankedOnly === null}
            onChange={(e) => void toggleRankedOnly(e.target.checked)}
            className="h-4 w-4 accent-blue-500"
          />
          Record ranked games only
        </label>
        <p className="mt-1 text-xs text-gray-500">
          Skips normals, ARAM, bots and customs. Detected via the League client, so the client must
          be running. If the queue can&apos;t be determined, the game is recorded so ranked is never
          missed.
        </p>
      </div>

      <div className="mt-4 border-t border-edge pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Startup</h3>
        <label className="mt-2 flex items-center gap-2 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={launchAtLogin ?? false}
            disabled={launchAtLogin === null}
            onChange={(e) => void toggleLaunch(e.target.checked)}
            className="h-4 w-4 accent-blue-500"
          />
          Launch at login and run in the background
        </label>
        <p className="mt-1 text-xs text-gray-500">
          Starts hidden in the system tray so games record automatically. Takes effect in the
          installed app (not in development).
        </p>
      </div>

      <div className="mt-4 border-t border-edge pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Maintenance</h3>
        <p className="mt-1 text-xs text-gray-500">
          Re-process stored event snapshots to fill in champion, KDA and the timeline for older
          matches.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={runBackfill}
            disabled={backfilling}
            className="rounded border border-edge px-3 py-1.5 text-sm text-white hover:bg-ink disabled:opacity-50"
          >
            {backfilling ? 'Backfilling…' : 'Backfill old matches'}
          </button>
          {summary && (
            <span className="text-sm text-green-400">
              Processed {summary.matchesProcessed} match
              {summary.matchesProcessed === 1 ? '' : 'es'}, inserted {summary.eventsInserted} event
              {summary.eventsInserted === 1 ? '' : 's'}.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
