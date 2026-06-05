import { useEffect, useState } from 'react';
import type { ObsSettingsView, ObsTestResult } from '@shared/ipc-contract';

export function ObsSettingsCard() {
  const [view, setView] = useState<ObsSettingsView | null>(null);
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(4455);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<ObsTestResult | null>(null);

  useEffect(() => {
    void window.api.settings.getObs().then((v) => {
      setView(v);
      setHost(v.host);
      setPort(v.port);
    });
  }, []);

  async function save() {
    setSaving(true);
    try {
      const next = await window.api.settings.setObs({
        host,
        port,
        // Only send the password if the user typed one.
        password: password.length > 0 ? password : undefined,
      });
      setView(next);
      setPassword('');
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTest(await window.api.obs.testConnection());
  }

  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
        OBS WebSocket
      </h2>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Host
          <input
            className="rounded border border-edge bg-ink px-2 py-1 text-white"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Port
          <input
            type="number"
            className="rounded border border-edge bg-ink px-2 py-1 text-white"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1 text-xs text-gray-400">
        Password {view?.hasPassword && <span className="text-green-500">(saved)</span>}
        <input
          type="password"
          placeholder={view?.hasPassword ? '•••••••• (leave blank to keep)' : 'OBS WS password'}
          className="rounded border border-edge bg-ink px-2 py-1 text-white"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={runTest}
          className="rounded border border-edge px-3 py-1.5 text-sm text-white hover:bg-ink"
        >
          Test Connection
        </button>
        {test && (
          <span className={test.ok ? 'text-sm text-green-400' : 'text-sm text-red-400'}>
            {test.ok
              ? `OK — OBS ${test.obsVersion} (ws ${test.websocketVersion})`
              : `Failed: ${test.error}`}
          </span>
        )}
      </div>
    </div>
  );
}
