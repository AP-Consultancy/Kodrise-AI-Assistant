import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { DEFAULT_STT_PUBLIC_CONFIG } from '../../src/shared/config/types';

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock('../../src/main/services/logging', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = FakeSocket.CONNECTING;
  bufferedAmount = 0;
  sent: Buffer[] = [];

  send(data: Buffer | string) {
    this.sent.push(typeof data === 'string' ? Buffer.from(data) : data);
  }

  close() {
    this.readyState = 3;
    this.emit('close', 1000, Buffer.from(''));
  }

  terminate() {
    this.readyState = 3;
    this.emit('close', 1006, Buffer.from(''));
  }

  openNow() {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
  }
}

describe('STT / interview audio lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not connect STT before Start Interview / audio.start', async () => {
    const { AudioHost } = await import('../../src/main/services/audio/AudioHost');
    const { MockSTTProvider } = await import('../../src/core/stt/MockSTTProvider');
    const stt = new MockSTTProvider();
    const host = new AudioHost({ stt });

    expect(host.getSttStatus().status).toBe('disconnected');
    expect(host.getAudioStatus().state).toBe('idle');
    host.dispose();
  });

  it('starts STT on audio.start (Start Interview listening path)', async () => {
    const { AudioHost } = await import('../../src/main/services/audio/AudioHost');
    const { MockSTTProvider } = await import('../../src/core/stt/MockSTTProvider');
    const stt = new MockSTTProvider();
    const host = new AudioHost({ stt });

    host.setPermission('granted');
    await host.start({ sampleRate: 16000, channels: 1 });
    host.confirmActive();

    expect(host.getAudioStatus().state).toBe('active');
    expect(host.getSttStatus().status).toBe('connected');
    host.dispose();
  });

  it('disconnects STT on pause and reconnects on resume', async () => {
    const { AudioHost } = await import('../../src/main/services/audio/AudioHost');
    const { MockSTTProvider } = await import('../../src/core/stt/MockSTTProvider');
    const stt = new MockSTTProvider();
    const host = new AudioHost({ stt });

    host.setPermission('granted');
    await host.start({ sampleRate: 16000, channels: 1 });
    host.confirmActive();
    await host.pause();

    expect(host.getAudioStatus().state).toBe('paused');
    expect(host.getSttStatus().status).toBe('disconnected');

    await host.resume();
    expect(host.getAudioStatus().state).toBe('active');
    expect(host.getSttStatus().status).toBe('connected');
    host.dispose();
  });

  it('cleans up STT on end-session force stop', async () => {
    const { AudioHost } = await import('../../src/main/services/audio/AudioHost');
    const { MockSTTProvider } = await import('../../src/core/stt/MockSTTProvider');
    const stt = new MockSTTProvider();
    const host = new AudioHost({ stt });

    host.setPermission('granted');
    await host.start({ sampleRate: 16000, channels: 1 });
    host.confirmActive();
    await host.forceStopFromSession();

    expect(host.getAudioStatus().active).toBe(false);
    expect(host.getSttStatus().status).toBe('disconnected');
    host.dispose();
  });

  it('prevents duplicate connections when start is called while already active', async () => {
    const { AudioHost } = await import('../../src/main/services/audio/AudioHost');
    let connectCount = 0;
    const { MockSTTProvider } = await import('../../src/core/stt/MockSTTProvider');
    const stt = new MockSTTProvider();
    const originalConnect = stt.connect.bind(stt);
    stt.connect = async () => {
      connectCount += 1;
      return originalConnect();
    };
    const host = new AudioHost({ stt });

    host.setPermission('granted');
    await host.start({ sampleRate: 16000, channels: 1 });
    host.confirmActive();
    await host.start({ sampleRate: 16000, channels: 1 });

    expect(connectCount).toBe(1);
    expect(host.getSttStatus().status).toBe('connected');
    host.dispose();
  });
});

describe('Deepgram reconnect cancellation and close diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels reconnect backoff when disconnect is called', async () => {
    const sockets: FakeSocket[] = [];
    class FakeWebSocket extends FakeSocket {
      constructor(_url: string, _opts?: unknown) {
        super();
        sockets.push(this);
        queueMicrotask(() => this.openNow());
      }
    }

    const { DeepgramSTTProvider } = await import(
      '../../src/main/transcription/provider/DeepgramSTTProvider'
    );
    const { logger } = await import('../../src/main/services/logging');

    const provider = new DeepgramSTTProvider({
      config: { ...DEFAULT_STT_PUBLIC_CONFIG },
      getApiKey: async () => 'test-key',
      webSocketCtor: FakeWebSocket as unknown as typeof import('ws'),
      enableReconnect: true,
      maxRetries: 3,
    });

    await provider.connect();
    expect(provider.getStatus().status).toBe('connected');

    sockets[0]?.emit('close', 1011, Buffer.from('net timeout'));
    await vi.advanceTimersByTimeAsync(10);
    expect(provider.getStatus().status).toBe('reconnecting');

    await provider.disconnect();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(provider.getStatus().status).toBe('disconnected');
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      'stt.reconnect.cancelled',
      expect.objectContaining({ provider: 'deepgram' }),
    );
  });

  it('logs close code, reason, and 1011 idle hint without credentials', async () => {
    const sockets: FakeSocket[] = [];
    class FakeWebSocket extends FakeSocket {
      constructor(_url: string, _opts?: unknown) {
        super();
        sockets.push(this);
        queueMicrotask(() => this.openNow());
      }
    }

    const { DeepgramSTTProvider, classifyCloseCode } = await import(
      '../../src/main/transcription/provider/DeepgramSTTProvider'
    );
    const { logger } = await import('../../src/main/services/logging');

    expect(classifyCloseCode(1011)).toBe('server_internal_or_idle_timeout');

    const provider = new DeepgramSTTProvider({
      config: { ...DEFAULT_STT_PUBLIC_CONFIG },
      getApiKey: async () => 'secret-test-key',
      webSocketCtor: FakeWebSocket as unknown as typeof import('ws'),
      enableReconnect: false,
    });

    await provider.connect();
    sockets[0]?.emit('close', 1011, Buffer.from('Token secret-test-key idle'));
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      'stt.connection.failed',
      expect.objectContaining({
        code: 1011,
        closeClass: 'server_internal_or_idle_timeout',
        hint: 'idle_or_server_timeout_often_means_no_audio_while_socket_open',
      }),
    );

    const failedCall = vi
      .mocked(logger.warn)
      .mock.calls.find((call) => call[0] === 'stt.connection.failed');
    const payload = JSON.stringify(failedCall?.[1] ?? {});
    expect(payload).not.toContain('secret-test-key');
  });
});
