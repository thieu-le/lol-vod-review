import OBSWebSocket from 'obs-websocket-js';
import { EventEmitter } from 'node:events';
import type { ObsConnectionState } from '@shared/types';
import type { ObsRecordingConfig } from '@shared/ipc-contract';
import { config } from '../../lib/config';
import { AppError, toMessage } from '../../lib/errors';
import { createLogger } from '../../lib/logger';
import { settingsRepository } from '../database/repositories/settingsRepository';

export interface ApplyRecommendedResult {
  applied: ObsRecordingConfig;
  warnings: string[];
}

const logger = createLogger('obs');

export interface ObsTestInfo {
  obsVersion: string;
  websocketVersion: string;
}

// Wraps obs-websocket-js v5 with reconnect/backoff and a small command surface.
// Emits 'stateChanged' (ObsConnectionState) for the recorder/UI to observe.
export class ObsClient extends EventEmitter {
  private obs = new OBSWebSocket();
  private state: ObsConnectionState = 'disconnected';
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay: number = config.obs.reconnectBaseMs;
  private shouldStayConnected = false;

  constructor() {
    super();
    this.obs.on('ConnectionClosed', () => {
      this.setState('disconnected');
      if (this.shouldStayConnected) this.scheduleReconnect();
    });
  }

  getState(): ObsConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  // Begin maintaining a persistent connection (auto-reconnect on drop).
  async start(): Promise<void> {
    this.shouldStayConnected = true;
    await this.tryConnect();
  }

  async stop(): Promise<void> {
    this.shouldStayConnected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      await this.obs.disconnect();
    } catch {
      /* ignore */
    }
    this.setState('disconnected');
  }

  // One-off connect to validate settings; does not affect the managed connection.
  async testConnection(): Promise<ObsTestInfo> {
    const probe = new OBSWebSocket();
    const { host, port, password } = settingsRepository().getObs();
    try {
      const { obsWebSocketVersion } = await probe.connect(
        `ws://${host}:${port}`,
        password || undefined
      );
      const ver = await probe.call('GetVersion');
      return {
        obsVersion: ver.obsVersion,
        websocketVersion: obsWebSocketVersion,
      };
    } catch (err) {
      throw new AppError('OBS_CONNECT_FAILED', toMessage(err), err);
    } finally {
      probe.disconnect().catch(() => undefined);
    }
  }

  async startRecording(): Promise<void> {
    this.assertConnected();
    try {
      await this.obs.call('StartRecord');
    } catch (err) {
      throw new AppError('OBS_REQUEST_FAILED', `StartRecord failed: ${toMessage(err)}`, err);
    }
  }

  // Returns the absolute path of the saved recording file.
  async stopRecording(): Promise<string> {
    this.assertConnected();
    try {
      const res = await this.obs.call('StopRecord');
      return res.outputPath;
    } catch (err) {
      throw new AppError('OBS_REQUEST_FAILED', `StopRecord failed: ${toMessage(err)}`, err);
    }
  }

  async isRecording(): Promise<boolean> {
    this.assertConnected();
    const res = await this.obs.call('GetRecordStatus');
    return res.outputActive;
  }

  // ---- Recording config (read + apply recommended) ----

  // Reads the recording-relevant OBS settings over the WebSocket so the UI can
  // show what's configured and flag anything sub-optimal.
  async getRecordingConfig(): Promise<ObsRecordingConfig> {
    this.assertConnected();
    const v = await this.obs.call('GetVideoSettings');
    const [outputMode, encoder, quality, format] = await Promise.all([
      this.getParam('Output', 'Mode'),
      this.getParam('SimpleOutput', 'RecEncoder'),
      this.getParam('SimpleOutput', 'RecQuality'),
      this.getParam('SimpleOutput', 'RecFormat2'),
    ]);
    return {
      outputMode: outputMode || 'Simple',
      encoder,
      quality,
      format,
      baseWidth: v.baseWidth,
      baseHeight: v.baseHeight,
      outputWidth: v.outputWidth,
      outputHeight: v.outputHeight,
      fps: v.fpsDenominator ? Math.round(v.fpsNumerator / v.fpsDenominator) : v.fpsNumerator,
    };
  }

  // Pushes recommended recording settings into the active OBS profile: NVENC at
  // 1440p60 in Simple mode, fragmented MP4 (crash-safe + upload-ready), and
  // "High Quality, Medium File Size". Output is downscaled to 1440p only if the
  // canvas is taller — never upscaled. Reads back to confirm what stuck.
  async applyRecommendedRecording(encoder: string): Promise<ApplyRecommendedResult> {
    this.assertConnected();
    if (await this.isRecording()) {
      throw new AppError('OBS_REQUEST_FAILED', 'Stop recording before changing OBS settings.');
    }

    const v = await this.obs.call('GetVideoSettings');
    const targetHeight = 1440;
    const scale = v.baseHeight > targetHeight ? targetHeight / v.baseHeight : 1;
    const outputWidth = Math.round((v.baseWidth * scale) / 2) * 2; // keep dimensions even
    const outputHeight = Math.round((v.baseHeight * scale) / 2) * 2;
    await this.obs.call('SetVideoSettings', {
      baseWidth: v.baseWidth,
      baseHeight: v.baseHeight,
      outputWidth,
      outputHeight,
      fpsNumerator: 60,
      fpsDenominator: 1,
    });

    await this.setParam('Output', 'Mode', 'Simple');
    await this.setParam('SimpleOutput', 'RecEncoder', encoder);
    await this.setParam('SimpleOutput', 'RecQuality', 'Small'); // High Quality, Medium File Size
    await this.setParam('SimpleOutput', 'RecFormat2', 'fragmented_mp4');

    const applied = await this.getRecordingConfig();
    const warnings: string[] = [];
    if (applied.outputMode.toLowerCase() !== 'simple') {
      warnings.push(
        'OBS stayed in Advanced output mode. Switch to Simple (OBS → Settings → Output) or set the encoder/quality there yourself.'
      );
    }
    if (applied.encoder !== encoder) {
      warnings.push(
        `Encoder didn't apply (OBS reports "${applied.encoder || 'unknown'}"). Your OBS version/GPU may use a different id — set the recording encoder to NVENC manually in OBS → Settings → Output.`
      );
    }
    if (applied.format !== 'fragmented_mp4') {
      warnings.push(
        `Recording format is "${applied.format || 'unknown'}". Set it to "Fragmented MP4" in OBS for crash-safe, upload-ready files.`
      );
    }
    if (applied.fps !== 60) {
      warnings.push(`FPS reads ${applied.fps}; expected 60.`);
    }
    logger.info(
      `Applied recommended OBS settings: ${applied.outputWidth}x${applied.outputHeight}@${applied.fps}, encoder=${applied.encoder}, format=${applied.format}`
    );
    return { applied, warnings };
  }

  private async getParam(category: string, name: string): Promise<string> {
    try {
      const r = await this.obs.call('GetProfileParameter', {
        parameterCategory: category,
        parameterName: name,
      });
      return (r.parameterValue ?? r.defaultParameterValue ?? '') as string;
    } catch {
      return '';
    }
  }

  private async setParam(category: string, name: string, value: string): Promise<void> {
    await this.obs.call('SetProfileParameter', {
      parameterCategory: category,
      parameterName: name,
      parameterValue: value,
    });
  }

  // ---- Replay buffer (designed-in; unused in Phase 1) ----
  async startReplayBuffer(): Promise<void> {
    this.assertConnected();
    await this.obs.call('StartReplayBuffer');
  }
  async stopReplayBuffer(): Promise<void> {
    this.assertConnected();
    await this.obs.call('StopReplayBuffer');
  }
  async saveReplayBuffer(): Promise<void> {
    this.assertConnected();
    await this.obs.call('SaveReplayBuffer');
  }

  private async tryConnect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') return;
    this.setState('connecting');
    const { host, port, password } = settingsRepository().getObs();
    try {
      await this.obs.connect(`ws://${host}:${port}`, password || undefined);
      this.reconnectDelay = config.obs.reconnectBaseMs;
      this.setState('connected');
      logger.info(`Connected to OBS at ${host}:${port}`);
    } catch (err) {
      logger.warn('OBS connect failed:', toMessage(err));
      this.setState('disconnected');
      if (this.shouldStayConnected) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    logger.info(`Reconnecting to OBS in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, config.obs.reconnectMaxMs);
      void this.tryConnect();
    }, delay);
  }

  private assertConnected(): void {
    if (!this.isConnected()) {
      throw new AppError('OBS_NOT_CONNECTED', 'OBS WebSocket is not connected');
    }
  }

  private setState(next: ObsConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.emit('stateChanged', next);
  }
}

export const obsClient = new ObsClient();
