import { useEffect, useState } from 'react';
import { MonitorPlay } from 'lucide-react';
import type { YoutubeSettingsView, YoutubeStatus } from '@shared/ipc-contract';
import { Toggle } from './Toggle';

export function YoutubeSettingsCard() {
  const [view, setView] = useState<YoutubeSettingsView | null>(null);
  const [status, setStatus] = useState<YoutubeStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [autoUpload, setAutoUpload] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    void window.api.youtube.getSettings().then((v) => {
      setView(v);
      setClientId(v.clientId);
      setAutoUpload(v.uploadMode === 'auto');
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
        uploadMode: autoUpload ? 'auto' : 'manual',
      });
      setView(next);
      setAutoUpload(next.uploadMode === 'auto');
      setClientSecret('');
      setStatus(await window.api.youtube.getStatus());
    } finally {
      setSaving(false);
    }
  }

  // The toggle persists immediately (optimistic, rolled back on failure) so it
  // behaves like a switch rather than a form field awaiting Save.
  async function toggleAutoUpload(next: boolean) {
    const prev = autoUpload;
    setAutoUpload(next);
    try {
      const saved = await window.api.youtube.setSettings({
        clientId: view?.clientId ?? clientId,
        uploadMode: next ? 'auto' : 'manual',
      });
      setView(saved);
      setAutoUpload(saved.uploadMode === 'auto');
    } catch {
      setAutoUpload(prev);
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
    <div className="glass-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="card-title flex items-center gap-2">
          <MonitorPlay size={13} /> YouTube Account
        </h2>
        {status && (
          <span
            className={`chip ${
              status.connected ? 'bg-win/15 text-win-text' : 'bg-white/5 text-gray-400'
            }`}
          >
            {status.connected ? 'Connected' : 'Not connected'}
          </span>
        )}
      </div>

      <p className="mb-4 text-xs text-gray-500">
        Create an OAuth 2.0 Desktop client in Google Cloud (YouTube Data API v3) and paste its
        credentials below. Uploads are Unlisted — not searchable or public, but anyone with the
        link can watch, which lets the in-app player stream a match after its local file is
        deleted.
      </p>

      <label className="field-label">
        OAuth Client ID
        <input className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} />
      </label>
      <label className="field-label mt-3">
        <span>
          OAuth Client Secret{' '}
          {view?.hasSecret && <span className="normal-case text-win-text">(saved)</span>}
        </span>
        <input
          type="password"
          placeholder={view?.hasSecret ? '•••••••• (leave blank to keep)' : 'Client secret'}
          className="input"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </label>

      <div className="mt-4 border-t border-edge pt-4">
        <Toggle
          checked={autoUpload}
          disabled={view === null}
          onChange={(next) => void toggleAutoUpload(next)}
          label="Auto-upload VODs"
          description="Instantly upload every match when it ends. Off = upload each match manually."
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary !py-1.5">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {status?.connected ? (
          <button onClick={disconnect} className="btn-ghost !py-1.5">
            Disconnect
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={connecting || !status?.hasCredentials}
            className="btn-ghost !py-1.5"
          >
            {connecting ? 'Waiting for browser…' : 'Connect YouTube account'}
          </button>
        )}
        {error && <span className="text-sm text-loss-text">{error}</span>}
      </div>
      {!status?.hasCredentials && (
        <p className="mt-2 text-xs text-gray-500">
          Save your client ID and secret before connecting.
        </p>
      )}
    </div>
  );
}
