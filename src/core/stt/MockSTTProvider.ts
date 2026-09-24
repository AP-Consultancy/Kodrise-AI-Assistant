import type { AudioChunk } from '../../shared/audio/types';
import type { TranscriptEvent } from '../../shared/transcription/types';
import type { STTMetrics, STTProviderStatus, STTStatus, Unsubscribe } from '../../shared/stt/types';
import { EMPTY_STT_METRICS } from '../../shared/stt/types';
import type { STTProvider } from './STTProvider';

/**
 * Deterministic mock STT for unit tests and offline development.
 * Emits partial/final transcript events from audio activity signals only.
 */
export class MockSTTProvider implements STTProvider {
  private status: STTStatus = 'disconnected';
  private errorMessage: string | null = null;
  private chunkCount = 0;
  private metrics: STTMetrics = { ...EMPTY_STT_METRICS };
  private readonly partialListeners = new Set<(event: TranscriptEvent) => void>();
  private readonly finalListeners = new Set<(event: TranscriptEvent) => void>();
  private readonly statusListeners = new Set<(status: STTProviderStatus) => void>();

  async connect(): Promise<void> {
    this.status = 'connecting';
    this.emitStatus();
    this.chunkCount = 0;
    this.metrics = { ...EMPTY_STT_METRICS };
    this.status = 'connected';
    this.errorMessage = null;
    this.emitStatus();
  }

  async sendAudio(chunk: AudioChunk): Promise<void> {
    if (this.status !== 'connected' && this.status !== 'streaming' && this.status !== 'reconnecting') {
      return;
    }
    void chunk.data;
    const sendStarted = Date.now();
    this.chunkCount += 1;
    this.metrics.chunksSent = this.chunkCount;
    this.metrics.lastChunkSendLatencyMs = Date.now() - sendStarted;
    if (this.status === 'connected') {
      this.status = 'streaming';
      this.emitStatus();
    }
    const now = Date.now();

    if (this.chunkCount % 5 === 0) {
      this.metrics.partialsReceived += 1;
      this.metrics.lastPartialLatencyMs = 5;
      const event: TranscriptEvent = {
        type: 'PARTIAL',
        timestamp: now,
        segment: {
          id: 'mock-partial',
          text: `Listening… (audio frames: ${this.chunkCount})`,
          timestamp: now,
          startTime: now,
          endTime: null,
          isFinal: false,
          confidence: 0.4,
        },
      };
      for (const listener of this.partialListeners) {
        listener(event);
      }
    }

    if (this.chunkCount % 25 === 0) {
      this.metrics.finalsReceived += 1;
      this.metrics.lastFinalLatencyMs = 12;
      const event: TranscriptEvent = {
        type: 'FINAL',
        timestamp: now,
        segment: {
          id: `mock-final-${this.chunkCount}`,
          text: `Mock final transcript segment #${Math.floor(this.chunkCount / 25)}`,
          timestamp: now,
          startTime: now - 1000,
          endTime: now,
          isFinal: true,
          confidence: 0.7,
        },
      };
      for (const listener of this.finalListeners) {
        listener(event);
      }
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

  /** Test helper — emit a FINAL as if Deepgram returned one. */
  emitFinalTranscript(text: string): void {
    const now = Date.now();
    const event: TranscriptEvent = {
      type: 'FINAL',
      timestamp: now,
      segment: {
        id: `mock-final-test-${now}`,
        text,
        timestamp: now,
        startTime: now - 500,
        endTime: now,
        isFinal: true,
        confidence: 0.95,
      },
    };
    for (const listener of this.finalListeners) {
      listener(event);
    }
  }

  onStatus(callback: (status: STTProviderStatus) => void): Unsubscribe {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    this.chunkCount = 0;
    this.errorMessage = null;
    this.emitStatus();
  }

  getStatus(): STTProviderStatus {
    return {
      status: this.status,
      errorMessage: this.errorMessage,
      provider: 'mock',
      configured: true,
      recoverable: false,
      metrics: { ...this.metrics },
    };
  }

  private emitStatus(): void {
    const snapshot = this.getStatus();
    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }
}
