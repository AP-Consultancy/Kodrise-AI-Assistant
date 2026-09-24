import WebSocket from 'ws';
import type { AudioChunk } from '../../../shared/audio/types';
import type { TranscriptEvent } from '../../../shared/transcription/types';
import type {
  STTMetrics,
  STTProviderStatus,
  STTStatus,
  Unsubscribe,
} from '../../../shared/stt/types';
import { EMPTY_STT_METRICS } from '../../../shared/stt/types';
import type { SttPublicConfig } from '../../../shared/config/types';
import {
  STTAuthenticationError,
  STTConfigurationError,
  STTConnectionError,
  STTProviderError,
  STTTimeoutError,
} from '../../../shared/errors';
import type { STTProvider } from '../../../core/stt/STTProvider';
import { adaptCaptureChunkToSttInput, DEEPGRAM_LINEAR16_FORMAT } from '../../../core/audio/AudioFormatAdapter';
import { logger } from '../../services/logging';

export interface DeepgramSTTProviderOptions {
  config: SttPublicConfig;
  getApiKey: () => Promise<string | null>;
  maxRetries?: number;
  connectTimeoutMs?: number;
  /** Injected WebSocket constructor for tests. */
  webSocketCtor?: typeof WebSocket;
  /** Disable automatic reconnect (tests). */
  enableReconnect?: boolean;
}

interface DeepgramResultsMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  start?: number;
  duration?: number;
  channel?: {
    alternatives?: Array<{
      transcript?: string;
      confidence?: number;
      words?: Array<{ start?: number; end?: number; confidence?: number }>;
    }>;
  };
}

const MAX_BUFFERED_BYTES = 256_000;
const MAX_CLOSE_REASON_CHARS = 160;

/**
 * Deepgram Listen streaming adapter (main process only).
 * Uses the public WebSocket API — SDK is not imported into core.
 */
export class DeepgramSTTProvider implements STTProvider {
  private status: STTStatus = 'disconnected';
  private errorMessage: string | null = null;
  private recoverable = false;
  private configured = false;
  private metrics: STTMetrics = { ...EMPTY_STT_METRICS };
  private socket: WebSocket | null = null;
  private intentionalClose = false;
  private connectGeneration = 0;
  private retryCount = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectWaitResolve: (() => void) | null = null;
  private streamStartedAt: number | null = null;
  private readonly maxRetries: number;
  private readonly connectTimeoutMs: number;
  private readonly enableReconnect: boolean;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly partialListeners = new Set<(event: TranscriptEvent) => void>();
  private readonly finalListeners = new Set<(event: TranscriptEvent) => void>();
  private readonly statusListeners = new Set<(status: STTProviderStatus) => void>();

  constructor(private readonly options: DeepgramSTTProviderOptions) {
    this.maxRetries = options.maxRetries ?? 3;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.enableReconnect = options.enableReconnect ?? true;
    this.WebSocketImpl = options.webSocketCtor ?? WebSocket;
  }

  async connect(): Promise<void> {
    this.intentionalClose = false;
    this.retryCount = 0;
    this.clearReconnectTimer();
    await this.openSocket();
  }

  async sendAudio(chunk: AudioChunk): Promise<void> {
    if (this.status !== 'connected' && this.status !== 'streaming') {
      return;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = adaptCaptureChunkToSttInput(chunk, {
      ...DEEPGRAM_LINEAR16_FORMAT,
      sampleRate: this.options.config.sampleRate,
      channels: this.options.config.channels,
    });

    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      logger.warn('stt.backpressure_drop', {
        bufferedAmount: this.socket.bufferedAmount,
        sequence: chunk.sequence,
      });
      return;
    }

    const started = Date.now();
    this.socket.send(Buffer.from(payload));
    this.metrics.chunksSent += 1;
    this.metrics.lastChunkSendLatencyMs = Date.now() - started;
    if (this.status === 'connected') {
      this.status = 'streaming';
      this.emitStatus();
    }
  }

  onPartialTranscript(callback: (event: TranscriptEvent) => void): Unsubscribe {
    this.partialListeners.add(callback);
    return () => this.partialListeners.delete(callback);
  }

  onFinalTranscript(callback: (event: TranscriptEvent) => void): Unsubscribe {
    this.finalListeners.add(callback);
    return () => this.finalListeners.delete(callback);
  }

  onStatus(callback: (status: STTProviderStatus) => void): Unsubscribe {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.connectGeneration += 1;
    await this.closeSocket();
    this.status = 'disconnected';
    this.errorMessage = null;
    this.recoverable = false;
    this.streamStartedAt = null;
    this.retryCount = 0;
    logger.info('stt.disconnected', { provider: 'deepgram' });
    this.emitStatus();
  }

  getStatus(): STTProviderStatus {
    return {
      status: this.status,
      errorMessage: this.errorMessage,
      provider: 'deepgram',
      configured: this.configured,
      recoverable: this.recoverable,
      metrics: { ...this.metrics },
    };
  }

  private async openSocket(): Promise<void> {
    const generation = ++this.connectGeneration;
    this.status = this.retryCount > 0 ? 'reconnecting' : 'connecting';
    this.errorMessage = null;
    this.recoverable = false;
    this.emitStatus();

    logger.info(
      this.retryCount > 0 ? 'stt.reconnecting' : 'stt.connection.started',
      { provider: 'deepgram', attempt: this.retryCount + 1 },
    );

    const apiKey = await this.options.getApiKey();
    this.configured = Boolean(apiKey);
    if (!apiKey) {
      const error = new STTConfigurationError('Deepgram API key is not configured', {
        credentialKey: 'stt.deepgram.apiKey',
      });
      this.fail(error.message, false);
      throw error;
    }

    const url = this.buildListenUrl();
    const connectStarted = Date.now();

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new this.WebSocketImpl(url, {
        headers: {
          Authorization: `Token ${apiKey}`,
        },
      });
      this.socket = socket;

      const timeout = setTimeout(() => {
        if (settled || generation !== this.connectGeneration) {
          return;
        }
        settled = true;
        socket.terminate();
        const error = new STTTimeoutError();
        this.fail(error.message, true);
        reject(error);
      }, this.connectTimeoutMs);

      socket.once('open', () => {
        if (settled || generation !== this.connectGeneration) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.metrics.connectionLatencyMs = Date.now() - connectStarted;
        this.status = 'connected';
        this.errorMessage = null;
        this.recoverable = false;
        this.retryCount = 0;
        this.streamStartedAt = Date.now();
        logger.info('stt.connection.connected', {
          provider: 'deepgram',
          connectionLatencyMs: this.metrics.connectionLatencyMs,
        });
        this.emitStatus();
        resolve();
      });

      socket.once('unexpected-response', (_req, res) => {
        if (settled || generation !== this.connectGeneration) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        const statusCode = res.statusCode ?? 0;
        const error =
          statusCode === 401 || statusCode === 403
            ? new STTAuthenticationError('Deepgram rejected the API key')
            : new STTConnectionError(`Deepgram connection rejected (${statusCode})`);
        this.fail(error.message, error.recoverable);
        reject(error);
      });

      socket.on('message', (data) => {
        if (generation !== this.connectGeneration) {
          return;
        }
        this.handleMessage(data);
      });

      socket.on('error', (err) => {
        logger.warn('stt.error', {
          provider: 'deepgram',
          message: sanitizeSocketMessage(err instanceof Error ? err.message : 'socket error'),
        });
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          const error = new STTConnectionError(
            err instanceof Error ? err.message : 'Deepgram socket error',
          );
          this.fail(error.message, true);
          reject(error);
        }
      });

      socket.on('close', (code, reasonBuf) => {
        clearTimeout(timeout);
        if (generation !== this.connectGeneration) {
          return;
        }
        this.socket = null;
        const reason = sanitizeCloseReason(reasonBuf);
        if (this.intentionalClose) {
          return;
        }
        if (!settled) {
          settled = true;
          const error = new STTConnectionError(
            `Deepgram socket closed before open (${code}${reason ? `: ${reason}` : ''})`,
          );
          this.fail(error.message, true);
          reject(error);
          return;
        }
        void this.handleUnexpectedClose(code, reason);
      });
    });
  }

  private handleMessage(data: WebSocket.RawData): void {
    let parsed: DeepgramResultsMessage;
    try {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      parsed = JSON.parse(text) as DeepgramResultsMessage;
    } catch {
      return;
    }

    if (parsed.type && parsed.type !== 'Results') {
      return;
    }

    const alternative = parsed.channel?.alternatives?.[0];
    const transcript = alternative?.transcript?.trim() ?? '';
    if (!transcript) {
      return;
    }

    const confidence =
      typeof alternative?.confidence === 'number' && Number.isFinite(alternative.confidence)
        ? alternative.confidence
        : null;

    const now = Date.now();
    const startOffsetSec = typeof parsed.start === 'number' ? parsed.start : null;
    const durationSec = typeof parsed.duration === 'number' ? parsed.duration : null;
    const base = this.streamStartedAt ?? now;
    const startTime = startOffsetSec !== null ? Math.round(base + startOffsetSec * 1000) : now;
    const endTime =
      startOffsetSec !== null && durationSec !== null
        ? Math.round(base + (startOffsetSec + durationSec) * 1000)
        : null;

    const speechFinal = Boolean(parsed.speech_final);
    const chunkFinal = Boolean(parsed.is_final);
    // With interim results, Deepgram emits many is_final chunks inside one spoken
    // utterance. Prefer speech_final as the utterance boundary. Also accept a
    // punctuated is_final as complete (Deepgram smart_format often adds "?").
    const interim = this.options.config.interimResults;
    const punctuatedFinal = chunkFinal && /[.!?]$/.test(transcript);
    const emitAsFinal = speechFinal || (chunkFinal && !interim) || punctuatedFinal;
    const event: TranscriptEvent = {
      type: emitAsFinal ? 'FINAL' : 'PARTIAL',
      timestamp: now,
      segment: {
        id: emitAsFinal ? `dg-final-${now}` : 'dg-partial',
        text: transcript,
        timestamp: now,
        startTime,
        endTime: emitAsFinal ? endTime : null,
        isFinal: emitAsFinal,
        confidence,
      },
    };

    if (emitAsFinal) {
      this.metrics.finalsReceived += 1;
      this.metrics.lastFinalLatencyMs = endTime !== null ? Math.max(0, now - endTime) : null;
      for (const listener of this.finalListeners) {
        listener(event);
      }
    } else {
      this.metrics.partialsReceived += 1;
      this.metrics.lastPartialLatencyMs = Math.max(0, now - startTime);
      for (const listener of this.partialListeners) {
        listener(event);
      }
    }
  }

  private async handleUnexpectedClose(code: number, reason: string): Promise<void> {
    if (this.intentionalClose) {
      return;
    }

    const closeClass = classifyCloseCode(code);
    logger.warn('stt.connection.failed', {
      provider: 'deepgram',
      code,
      reason: reason || undefined,
      closeClass,
      // 1011 commonly means Deepgram closed an idle Listen stream (no audio).
      hint:
        code === 1011
          ? 'idle_or_server_timeout_often_means_no_audio_while_socket_open'
          : undefined,
    });

    if (!this.enableReconnect || this.retryCount >= this.maxRetries) {
      this.fail(
        `Deepgram connection closed (${code}${reason ? `: ${reason}` : ''}; ${closeClass})`,
        false,
      );
      return;
    }

    this.retryCount += 1;
    this.status = 'reconnecting';
    this.recoverable = true;
    this.errorMessage = `Reconnecting to Deepgram (attempt ${this.retryCount}/${this.maxRetries})`;
    this.emitStatus();

    const generation = this.connectGeneration;
    const delayMs = Math.min(8_000, 500 * 2 ** (this.retryCount - 1));
    await new Promise<void>((resolve) => {
      this.reconnectWaitResolve = resolve;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.reconnectWaitResolve = null;
        resolve();
      }, delayMs);
    });

    // disconnect()/new connect() bumps generation or sets intentionalClose.
    if (this.intentionalClose || generation !== this.connectGeneration) {
      logger.info('stt.reconnect.cancelled', {
        provider: 'deepgram',
        attempt: this.retryCount,
        reason: this.intentionalClose ? 'intentional_close' : 'superseded',
      });
      return;
    }

    try {
      await this.openSocket();
    } catch {
      if (this.intentionalClose || generation !== this.connectGeneration) {
        return;
      }
      if (this.retryCount >= this.maxRetries) {
        this.fail('Deepgram reconnection failed', false);
      }
    }
  }

  private fail(message: string, recoverable: boolean): void {
    this.status = 'error';
    this.errorMessage = message;
    this.recoverable = recoverable;
    logger.warn('stt.error', {
      provider: 'deepgram',
      message: sanitizeSocketMessage(message),
      recoverable,
    });
    this.emitStatus();
  }

  private buildListenUrl(): string {
    const { config } = this.options;
    if (config.provider !== 'deepgram') {
      throw new STTConfigurationError(`Unsupported STT provider: ${config.provider}`);
    }
    if (config.sampleRate !== 16000 || config.channels !== 1) {
      throw new STTProviderError(
        'Deepgram Phase 2B adapter expects 16 kHz mono audio',
        false,
      );
    }

    const url = new URL(config.endpoint);
    url.searchParams.set('model', config.model);
    url.searchParams.set('language', config.language);
    url.searchParams.set('encoding', 'linear16');
    url.searchParams.set('sample_rate', String(config.sampleRate));
    url.searchParams.set('channels', String(config.channels));
    url.searchParams.set('interim_results', config.interimResults ? 'true' : 'false');
    url.searchParams.set('punctuate', 'true');
    url.searchParams.set('smart_format', 'true');
    // Helps Deepgram emit speech_final at natural pauses (utterance boundaries).
    url.searchParams.set('utterance_end_ms', '1200');
    return url.toString();
  }

  private async closeSocket(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) {
      return;
    }
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      socket.once('close', done);
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'CloseStream' }));
          socket.close();
        } else {
          socket.terminate();
          done();
        }
      } catch {
        try {
          socket.terminate();
        } catch {
          // ignore
        }
        done();
      }
      setTimeout(done, 1000);
    });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.reconnectWaitResolve) {
      const resolve = this.reconnectWaitResolve;
      this.reconnectWaitResolve = null;
      resolve();
    }
  }

  private emitStatus(): void {
    const snapshot = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }
}

export function classifyCloseCode(code: number): string {
  switch (code) {
    case 1000:
      return 'normal_closure';
    case 1001:
      return 'going_away';
    case 1006:
      return 'abnormal_closure';
    case 1008:
      return 'policy_violation';
    case 1011:
      return 'server_internal_or_idle_timeout';
    default:
      return 'other';
  }
}

function sanitizeCloseReason(reasonBuf: unknown): string {
  let text = '';
  if (typeof reasonBuf === 'string') {
    text = reasonBuf;
  } else if (Buffer.isBuffer(reasonBuf)) {
    text = reasonBuf.toString('utf8');
  } else if (reasonBuf instanceof ArrayBuffer) {
    text = Buffer.from(reasonBuf).toString('utf8');
  } else if (ArrayBuffer.isView(reasonBuf)) {
    text = Buffer.from(reasonBuf.buffer, reasonBuf.byteOffset, reasonBuf.byteLength).toString(
      'utf8',
    );
  }
  return sanitizeSocketMessage(text);
}

function sanitizeSocketMessage(message: string): string {
  const stripped = message
    .replace(/Token\s+\S+/gi, 'Token [redacted]')
    .replace(/api[_-]?key[=:]\s*\S+/gi, 'api_key=[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[redacted]');
  return stripped.slice(0, MAX_CLOSE_REASON_CHARS);
}
