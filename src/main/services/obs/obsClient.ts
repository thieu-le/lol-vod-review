import OBSWebSocket from 'obs-websocket-js';
import { EventEmitter } from 'node:events';
import type { ObsConnectionState } from '@shared/types';
import { config } from '../../lib/config';
import { AppError, toMessage } from '../../lib/errors';
import { createLogger } from '../../lib/logger';
import { settingsRepository } from '../database/repositories/settingsRepository';

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
