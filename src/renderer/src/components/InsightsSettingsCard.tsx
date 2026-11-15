import { useEffect, useState } from 'react';
import { FolderSearch } from 'lucide-react';
import type { InsightsSettingsView } from '@shared/ipc-contract';

function timeAgo(ms: number | null): string {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleString();
}

// Insights Capture records the games; this points the app at its video folder
// and database. Both default to Insights' own settings, so most installs can
// leave them blank.
export function InsightsSettingsCard() {
  const [view, setView] = useState<InsightsSettingsView | null>(null);
  const [videoDir, setVideoDir] = useState('');
  const [dbPath, setDbPath] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.api.insights.getSettings().then((v) => {
      setView(v);
      setVideoDir(v.settings.videoDir);
      setDbPath(v.settings.dbPath);
    });
    // Keep the status line live as the watcher scans.
    return window.api.recorder.onStatusChanged((s) =>
      setView((prev) => (prev ? { ...prev, status: s.insights } : prev))
    );
  }, []);

  async function save() {
    setSaving(true);
    try {
      setView(await window.api.insights.setSettings({ videoDir, dbPath }));
    } finally {
      setSaving(false);
    }
  }

  async function scan() {
    setView(await window.api.insights.scanNow());
  }

  const st = view?.status;
  const dirty = view !== null && (videoDir !== view.settings.videoDir || dbPath !== view.settings.dbPath);

  return (
    <div className="glass-card p-5">
      <h2 className="card-title mb-1 flex items-center gap-2">
        <FolderSearch size={13} /> Insights Capture
      </h2>
      <p className="mb-4 text-xs text-gray-500">
        Insights records your games. Every new League of Legends or VALORANT full-match recording
        it saves is added to the library and, with automatic upload on, queued for YouTube.
        Highlights and clips are ignored. Recordings that were already in the folder when this was
        first enabled are left alone.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="field-label">
          Video folder
          <input
            value={videoDir}
            onChange={(e) => setVideoDir(e.target.value)}
            placeholder={st?.videoDir || 'Same as Insights (Settings → Capture)'}
            className="input"
          />
        </label>
        <label className="field-label">
          Insights database
          <input
            value={dbPath}
            onChange={(e) => setDbPath(e.target.value)}
            placeholder={view?.resolvedDbPath || '%APPDATA%\\Insights Capture\\db.sqlite3'}
            className="input"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={() => void save()} disabled={!dirty || saving} className="btn-primary !py-1.5">
          Save
        </button>
        <button onClick={() => void scan()} className="btn-ghost !py-1.5">
          Scan now
        </button>
        {st && (
          <span className="text-xs text-gray-400">
            {st.state === 'watching' ? (
              <span className="text-win-text">Watching {st.videoDir}</span>
            ) : (
              <span className="text-loss-text">Folder not found: {st.videoDir || '(none)'}</span>
            )}
            {' · '}
            {st.dbAvailable ? 'database found' : (
              <span className="text-yellow-300">
                database not readable (chapters fall back to live League data)
              </span>
            )}
            {' · '}last import {timeAgo(st.lastIngestAt)}
          </span>
        )}
      </div>
      {st?.lastError && <p className="mt-2 text-xs text-loss-text">Last error: {st.lastError}</p>}
    </div>
  );
}
