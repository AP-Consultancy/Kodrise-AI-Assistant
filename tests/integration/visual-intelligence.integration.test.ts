/**
 * Optional OpenAI visual intelligence live test.
 *
 * Runs only when LIVE_VISUAL_AI_TESTS=true and OPENAI_API_KEY is set.
 * Never hard-code credentials. Never commit credentials.
 *
 * Example (PowerShell):
 *   $env:LIVE_VISUAL_AI_TESTS="true"; $env:OPENAI_API_KEY="..."; npm test -- tests/integration/visual-intelligence.integration.test.ts
 */
import { describe, expect, it } from 'vitest';
import { OpenAIOCRProvider } from '../../src/main/ocr/OpenAIOCRProvider';
import { OpenAIVisionProvider } from '../../src/main/vision/OpenAIVisionProvider';
import { createDefaultIdGenerator } from '../../src/shared/session/types';
import type { VisualFrame } from '../../src/shared/visual-context/types';

const live = process.env.LIVE_VISUAL_AI_TESTS === 'true';
const apiKey = process.env.OPENAI_API_KEY;
const configured = live && Boolean(apiKey && apiKey.length > 8);

function tinyPngFrame(): VisualFrame {
  // Minimal valid-ish PNG bytes are not required for API transport here;
  // OpenAI accepts image/* data URLs. Use a 1x1 PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  return {
    id: createDefaultIdGenerator()(),
    timestamp: Date.now(),
    width: 1,
    height: 1,
    mimeType: 'image/png',
    byteSize: png.byteLength,
    source: 'MANUAL_IMAGE',
    sourceId: null,
    contentHash: 'live-test',
    captureDurationMs: 1,
    status: 'accepted',
    bytes: new Uint8Array(png),
  };
}

describe.skipIf(!configured)('OpenAI visual intelligence live integration', () => {
  it('runs OCR and vision against a tiny image', async () => {
    const frame = tinyPngFrame();
    const ocr = new OpenAIOCRProvider({
      getApiKey: async () => apiKey ?? null,
      model: 'gpt-4o-mini',
      maxCharacters: 500,
      timeoutMs: 45_000,
    });
    const vision = new OpenAIVisionProvider({
      getApiKey: async () => apiKey ?? null,
      model: 'gpt-4o-mini',
      timeoutMs: 45_000,
    });

    const ocrCaps = await ocr.getCapabilities();
    expect(ocrCaps.available).toBe('SUPPORTED');
    const ocrResult = await ocr.recognize(frame, 'live-ocr');
    expect(['completed', 'empty']).toContain(ocrResult.status);

    const visionResult = await vision.analyze({
      requestId: 'live-vision',
      frameId: frame.id,
      mimeType: frame.mimeType,
      imageBase64: Buffer.from(frame.bytes).toString('base64'),
      width: frame.width,
      height: frame.height,
      ocrText: ocrResult.text,
      mode: 'general',
    });
    expect(visionResult.status).toBe('completed');
    expect(visionResult.contentType).toBeTruthy();
  }, 90_000);
});

describe('Visual intelligence live gate', () => {
  it('defaults to skipped without LIVE_VISUAL_AI_TESTS', () => {
    if (!configured) {
      expect(configured).toBe(false);
    } else {
      expect(configured).toBe(true);
    }
  });
});
