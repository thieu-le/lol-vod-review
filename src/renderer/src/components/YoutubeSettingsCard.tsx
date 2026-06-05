import { useEffect, useState } from 'react';
import { UPLOAD_MODE } from '@shared/types';
import type { UploadMode } from '@shared/types';
import type { YoutubeSettingsView, YoutubeStatus } from '@shared/ipc-contract';

const MODE_LABELS: Record<UploadMode, string> = {
  manual: 'Manual — I upload each match myself',
  auto: 'Automatic — upload every match when it ends',
};

export function YoutubeSettingsCard() {
  const [view, setView] = useState<YoutubeSettingsView | null>(null);
  const [status, setStatus] = useState<YoutubeStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [uploadMode, setUploadMode] = useState<UploadMode>('manual');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    void window.api.youtube.getSettings().then((v) => {
      setView(v);
      setClientId(v.clientId);
      setUploadMode(v.uploadMode);
    });
    void window.api.youtube.getStatus().then(setStatus);
  }

  useEffect(load, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next = await window.api.youtube.setSettings({
        clientId,
        clientSecret: clientSecret.length > 0 ? clientSecret : undefined,
        uploadMode,
      });
      setView(next);
      setClientSecret('');
      setStatus(await window.api.youtube.getStatus());
    } finally {
      setSaving(false);
    }
  }

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await window.api.youtube.connect();
      setStatus(res.status);
      if (!res.ok) setError(res.error ?? 'Could not connect YouTube account');
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setStatus(await window.api.youtube.disconnect());
  }

  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">YouTube</h2>
        {status && (
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              status.connected ? 'bg-green-500/20 text-green-300' : 'bg-gray-500/20 text-gray-300'
            }`}
          >
            {status.connected ? 'Connected' : 'Not connected'}
          </span>
        )}
      </div>

      <p className="mb-3 text-xs text-gray-500">
        Create an OAuth 2.0 Desktop client in Google Cloud (YouTube Data API v3) and paste its
        credentials below. Uploads are Unlisted — not searchable or public, but anyone with the
        link can watch, which lets the in-app player stream a match after its local file is deleted.
      </p>

      <label className="flex flex-col gap-1 text-xs text-gray-400">
        OAuth Client ID
        <input
          className="rounded border border-edge bg-ink px-2 py-1 text-white"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-xs text-gray-400">
        OAuth Client Secret {view?.hasSecret && <span className="text-green-500">(saved)</span>}
        <input
          type="password"
          placeholder={view?.hasSecret ? '•••••••• (leave blank to keep)' : 'Client secret'}
          className="rounded border border-edge bg-ink px-2 py-1 text-white"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-xs text-gray-400">
        Upload mode
        <select
          value={uploadMode}
          onChange={(e) => setUploadMode(e.target.value as UploadMode)}
          className="rounded border border-edge bg-ink px-2 py-1 text-sm text-white"
        >
          {UPLOAD_MODE.map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {status?.connected ? (
          <button
            onClick={disconnect}
            className="rounded border border-edge px-3 py-1.5 text-sm text-white hover:bg-ink"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={connecting || !status?.hasCredentials}
            className="rounded border border-edge px-3 py-1.5 text-sm text-white hover:bg-ink disabled:opacity-50"
          >
            {connecting ? 'Waiting for browser…' : 'Connect YouTube account'}
          </button>
        )}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
      {!status?.hasCredentials && (
        <p className="mt-2 text-xs text-gray-500">Save your client ID and secret before connecting.</p>
      )}
    </div>
  );
}
