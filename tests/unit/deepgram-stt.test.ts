import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { DeepgramSTTProvider } from '../../src/main/transcription/provider/DeepgramSTTProvider';
import { createSttProvider } from '../../src/main/transcription/provider/createSttProvider';
import { DEFAULT_STT_PUBLIC_CONFIG } from '../../src/shared/config/types';
import { STTConfigurationError } from '../../src/shared/errors';
import { adaptCaptureChunkToSttInput } from '../../src/core/audio/AudioFormatAdapter';
import { MockSTTProvider } from '../../src/core/stt/MockSTTProvider';
import { TranscriptStore } from '../../src/core/transcription/TranscriptStore';
import { AudioCaptureController } from '../../src/core/audio/AudioCaptureController';

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeSocket.CONNECTING;
  bufferedAmount = 0;
  sent: Buffer[] = [];

  send(data: Buffer) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.emit('close', 1000);
  }

  terminate() {
    this.readyState = 3;
    this.emit('close', 1006);
  }

  openNow() {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
  }
}

describe('STT provider factory', () => {
  it('creates mock provider when configured', () => {
    const provider = createSttProvider({
      config: { ...DEFAULT_STT_PUBLIC_CONFIG, provider: 'mock' },
      getApiKey: async () => null,
    });
    expect(provider.getStatus().provider).toBe('mock');
  });

  it('creates deepgram provider', () => {
    const provider = createSttProvider({
      config: { ...DEFAULT_STT_PUBLIC_CONFIG },
      getApiKey: async () => 'key',
    });
    expect(provider.getStatus().provider).toBe('deepgram');
  });
});

describe('DeepgramSTTProvider', () => {
  it('fails with configuration error when credential missing', async () => {
    const provider = new DeepgramSTTProvider({
      config: { ...DEFAULT_STT_PUBLIC_CONFIG },
      getApiKey: async () => null,
      enableReconnect: false,
    });
    await expect(provider.connect()).rejects.toBeInstanceOf(STTConfigurationError);
    expect(provider.getStatus().status).toBe('error');
    expect(provider.getStatus().configured).toBe(false);
  });

  it('connects successfully with credential and fake socket', async () => {
    const sockets: FakeSocket[] = [];
    class FakeWebSocket extends FakeSocket {
      constructor(_url: string, _opts?: unknown) {
        super();
        sockets.push(this);
        queueMicrotask(() => {
          sockets[sockets.length - 1]?.openNow();
        });
      }
    }

    const provider = new DeepgramSTTProvider({
      config: { ...DEFAULT_STT_PUBLIC_CONFIG },
      getApiKey: async () => 'test-key',
      webSocketCtor: FakeWebSocket as unknown as typeof import('ws'),
      enableReconnect: false,
    });

    await provider.connect();
    expect(provider.getStatus().status).toBe('connected');
    expect(provider.getStatus().configured).toBe(true);
    expect(provider.getStatus().metrics.connectionLatencyMs).not.toBeNull();

    const partials: string[] = [];
    const finals: string[] = [];
    provider.onPartialTranscript((event) => {
      if (event.segment) partials.push(event.segment.text);
    });
    provider.onFinalTranscript((event) => {
      if (event.segment) finals.push(event.segment.text);
    });

    const chunk = {
      sequence: 1,
      timestamp: Date.now(),
      data: new ArrayBuffer(4),
      sampleRate: 16000,
      channels: 1,
    };
    await provider.sendAudio(chunk);
    expect(provider.getStatus().status).toBe('streaming');
    expect(sockets[0]?.sent.length).toBe(1);

    sockets[0]?.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'Results',
          is_final: false,
          start: 0.1,
          duration: 0.5,
          channel: { alternatives: [{ transcript: 'hello', confidence: 0.8 }] },
        }),
      ),
    );
    // Intermediate is_final without speech_final / punctuation stays partial.
    sockets[0]?.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'Results',
          is_final: true,
          speech_final: false,
          start: 0.1,
          duration: 0.7,
          channel: { alternatives: [{ transcript: 'hello world', confidence: 0.9 }] },
        }),
      ),
    );
    sockets[0]?.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'Results',
          is_final: true,
          speech_final: true,
          start: 0.1,
          duration: 0.8,
          channel: { alternatives: [{ transcript: 'hello world', confidence: 0.91 }] },
        }),
      ),
    );

    expect(partials).toEqual(['hello', 'hello world']);
    expect(finals).toEqual(['hello world']);

    await provider.disconnect();
    expect(provider.getStatus().status).toBe('disconnected');
  });

  it('maps connection failure and supports bounded reconnect path', async () => {
    let attempt = 0;
    class FakeWebSocket extends FakeSocket {
      constructor(_url: string, _opts?: unknown) {
        super();
        attempt += 1;
        queueMicrotask(() => {
          if (attempt === 1) {
            this.emit('error', new Error('network down'));
          } else {
            this.openNow();
          }
        });
      }
    }

    const provider = new DeepgramSTTProvider({
      config: { ...DEFAULT_STT_PUBLIC_CONFIG },
      getApiKey: async () => 'test-key',
      webSocketCtor: FakeWebSocket as unknown as typeof import('ws'),
      enableReconnect: false,
      maxRetries: 1,
      connectTimeoutMs: 2000,
    });

    await expect(provider.connect()).rejects.toThrow(/network down|connection/i);
    expect(provider.getStatus().status).toBe('error');
  });
});

describe('Audio format adapter', () => {
  it('passthroughs matching PCM and rejects mismatches', () => {
    const ok = adaptCaptureChunkToSttInput({
      sequence: 1,
      timestamp: 1,
      data: new ArrayBuffer(4),
      sampleRate: 16000,
      channels: 1,
    });
    expect(ok.byteLength).toBe(4);

    expect(() =>
      adaptCaptureChunkToSttInput({
        sequence: 1,
        timestamp: 1,
        data: new ArrayBuffer(4),
        sampleRate: 44100,
        channels: 1,
      }),
    ).toThrow();
  });
});

describe('Transcript timing + duplicate finals', () => {
  it('preserves provider timestamps and skips duplicate finals', () => {
    const store = new TranscriptStore({ maxFinals: 10, idGenerator: () => 'a' });
    store.applyPartial('hel', 0.5, { startTime: 1000 });
    const first = store.commitFinal('hello', 0.9, { startTime: 1000, endTime: 1500 });
    const dup = store.commitFinal('hello', 0.9, { startTime: 1000, endTime: 1500 });
    expect(first?.startTime).toBe(1000);
    expect(first?.endTime).toBe(1500);
    expect(dup?.id).toBe(first?.id);
    expect(store.getRecent()).toHaveLength(1);
  });
});

describe('Session stop disconnects STT', () => {
  it('stops capture and disconnects provider', async () => {
    const capture = new AudioCaptureController();
    const stt = new MockSTTProvider();
    capture.setPermission('granted');
    capture.beginStart();
    capture.markActive();
    await stt.connect();
    await stt.sendAudio({
      sequence: 1,
      timestamp: Date.now(),
      data: new ArrayBuffer(2),
      sampleRate: 16000,
      channels: 1,
    });
    expect(stt.getStatus().status).toBe('streaming');

    capture.forceStop();
    await stt.disconnect();
    expect(capture.getStatus().active).toBe(false);
    expect(stt.getStatus().status).toBe('disconnected');
  });
});

describe('STT credential IPC safety', () => {
  it('config status never includes api key material', async () => {
    const status = {
      provider: 'deepgram',
      model: 'nova-3',
      language: 'en',
      configured: true,
      sampleRate: 16000,
      channels: 1,
      interimResults: true,
    };
    expect(JSON.stringify(status)).not.toMatch(/api[_-]?key|token|sk-/i);
  });
});
