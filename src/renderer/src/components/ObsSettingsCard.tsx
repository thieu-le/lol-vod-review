import { useEffect, useState } from 'react';
import { Cable } from 'lucide-react';
import type {
  ObsApplyResult,
  ObsRecordingConfig,
  ObsSettingsView,
  ObsTestResult,
} from '@shared/ipc-contract';
import { DEFAULT_OBS_ENCODER, OBS_NVENC_ENCODER } from '@shared/types';
import type { ObsNvencEncoder } from '@shared/types';

const ENCODER_LABELS: Record<ObsNvencEncoder, string> = {
  nvenc_av1: 'AV1 — smallest files, fastest uploads (RTX 40/50)',
  nvenc_hevc: 'HEVC — high quality, broad compatibility',
  nvenc: 'H.264 — maximum compatibility',
};

export function ObsSettingsCard() {
  const [view, setView] = useState<ObsSettingsView | null>(null);
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(4455);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<ObsTestResult | null>(null);
  const [config, setConfig] = useState<ObsRecordingConfig | null>(null);
  const [encoder, setEncoder] = useState<ObsNvencEncoder>(DEFAULT_OBS_ENCODER);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ObsApplyResult | null>(null);

  function loadConfig() {
    void window.api.obs.getRecordingConfig().then(setConfig);
  }

  useEffect(() => {
    void window.api.settings.getObs().then((v) => {
      setView(v);
      setHost(v.host);
      setPort(v.port);
    });
    loadConfig();
  }, []);

  async function applyRecommended() {
    setApplying(true);
    setApplyResult(null);
    try {
      const res = await window.api.obs.applyRecommended(encoder);
      setApplyResult(res);
      if (res.applied) setConfig(res.applied);
    } finally {
      setApplying(false);
    }
  }

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
    loadConfig();
  }

  return (
    <div className="glass-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="card-title flex items-center gap-2">
          <Cable size={13} /> OBS Connection
        </h2>
        {config && <span className="chip bg-win/15 text-win-text">Connected</span>}
      </div>

      <div className="grid grid-cols-[1fr_120px] gap-3">
        <label className="field-label">
          Host Address
          <input className="input" value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="field-label">
          Port
          <input
            type="number"
            className="input"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
        </label>
      </div>
      <label className="field-label mt-3">
        <span>
          WebSocket Password{' '}
          {view?.hasPassword && <span className="normal-case text-win-text">(saved)</span>}
        </span>
        <input
          type="password"
          placeholder={view?.hasPassword ? '•••••••• (leave blank to keep)' : 'OBS WS password'}
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary !py-1.5">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={runTest} className="btn-ghost !py-1.5">
          Test Connection
        </button>
        {test && (
          <span className={test.ok ? 'text-sm text-win-text' : 'text-sm text-loss-text'}>
            {test.ok
              ? `OK — OBS ${test.obsVersion} (ws ${test.websocketVersion})`
              : `Failed: ${test.error}`}
          </span>
        )}
      </div>

      <div className="mt-5 border-t border-edge pt-4">
        <h3 className="card-title">Recommended recording settings</h3>
        <p className="mt-1 text-xs text-gray-500">
          Pushes NVENC · 1440p60 · Fragmented MP4 · High Quality (Medium File Size) into OBS&apos;s
          active profile. Downscales to 1440p only if your canvas is taller; never upscales. Stop
          recording before applying.
        </p>

        <div className="mt-3 rounded-lg border border-edge bg-raised/60 p-3 text-xs">
          {config ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-400">
              <span>
                Resolution:{' '}
                <span className="text-gray-200">
                  {config.outputWidth}×{config.outputHeight} @ {config.fps}fps
                </span>
              </span>
              <span>
                Encoder: <span className="text-gray-200">{config.encoder || '—'}</span>
              </span>
              <span>
                Format: <span className="text-gray-200">{config.format || '—'}</span>
              </span>
              <span>
                Mode: <span className="text-gray-200">{config.outputMode}</span>
              </span>
            </div>
          ) : (
            <span className="text-gray-500">
              Connect to OBS (Test Connection) to read current settings.
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="field-label">
            Encoder Strategy
            <select
              value={encoder}
              onChange={(e) => setEncoder(e.target.value as ObsNvencEncoder)}
              className="input"
            >
              {OBS_NVENC_ENCODER.map((enc) => (
                <option key={enc} value={enc}>
                  {ENCODER_LABELS[enc]}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={applyRecommended}
            disabled={applying || !config}
            className="btn-primary !py-1.5"
          >
            {applying ? 'Applying…' : 'Apply to OBS'}
          </button>
        </div>

        {applyResult && !applyResult.ok && (
          <p className="mt-2 text-sm text-loss-text">Failed: {applyResult.error}</p>
        )}
        {applyResult?.ok && (applyResult.warnings?.length ?? 0) === 0 && (
          <p className="mt-2 text-sm text-win-text">Applied. OBS is set for 1440p60 NVENC.</p>
        )}
        {applyResult?.ok && (applyResult.warnings?.length ?? 0) > 0 && (
          <div className="mt-2 text-sm text-yellow-400">
            <p>Applied with notes:</p>
            <ul className="ml-4 list-disc text-xs">
              {applyResult.warnings?.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
