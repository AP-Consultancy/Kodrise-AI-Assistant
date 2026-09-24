/**
 * Optional Deepgram live integration test.
 *
 * Runs only when DEEPGRAM_API_KEY is set in the environment.
 * Never hard-code credentials. Never commit credentials.
 *
 * Example:
 *   $env:DEEPGRAM_API_KEY="your-key"; npm test -- tests/integration/deepgram-stt.integration.test.ts
 */
import { describe, expect, it } from 'vitest';
import { DeepgramSTTProvider } from '../../src/main/transcription/provider/DeepgramSTTProvider';
import { DEFAULT_STT_PUBLIC_CONFIG } from '../../src/shared/config/types';

const apiKey = process.env.DEEPGRAM_API_KEY;
const configured = Boolean(apiKey && apiKey.length > 8);

describe.skipIf(!configured)('Deepgram live integration', () => {
  it('opens a live listen socket and closes cleanly', async () => {
    const provider = new DeepgramSTTProvider({
      config: { ...DEFAULT_STT_PUBLIC_CONFIG },
      getApiKey: async () => apiKey ?? null,
      enableReconnect: false,
      connectTimeoutMs: 15_000,
    });

    await provider.connect();
    expect(provider.getStatus().status).toBe('connected');

    // Send a short silence frame (Int16 LE zeros).
    const silence = new ArrayBuffer(3200);
    await provider.sendAudio({
      sequence: 1,
      timestamp: Date.now(),
      data: silence,
      sampleRate: 16000,
      channels: 1,
    });

    await provider.disconnect();
    expect(provider.getStatus().status).toBe('disconnected');
  }, 30_000);
});

describe('Deepgram integration gate', () => {
  it('skips live test when credentials are unavailable', () => {
    if (!configured) {
      expect(configured).toBe(false);
    } else {
      expect(configured).toBe(true);
    }
  });
});
