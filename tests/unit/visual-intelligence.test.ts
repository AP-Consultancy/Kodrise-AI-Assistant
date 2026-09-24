import { describe, expect, it } from 'vitest';
import { MockOCRProvider } from '../../src/core/ocr/MockOCRProvider';
import { normalizeOCRText } from '../../src/core/ocr/normalizeOCRText';
import { MockVisionProvider } from '../../src/core/vision/MockVisionProvider';
import { VisualIntelligencePipeline } from '../../src/core/visual-intelligence/VisualIntelligencePipeline';
import { RuleBasedVisualRelevanceEvaluator } from '../../src/core/visual-intelligence/VisualRelevanceEvaluator';
import { ContextBuilder } from '../../src/core/context/ContextBuilder';
import type { VisualFrame } from '../../src/shared/visual-context/types';
import type { OCRCapabilities, OCRResult } from '../../src/shared/ocr/types';
import type {
  VisionAnalysis,
  VisionAnalysisRequest,
  VisionCapabilities,
} from '../../src/shared/vision/types';
import type { OCRProvider } from '../../src/core/ocr/OCRProvider';
import type { VisionProvider } from '../../src/core/vision/VisionProvider';
import type { DetectedQuestion } from '../../src/shared/questions/types';
import { AppError, toSafeErrorPayload } from '../../src/shared/errors';
import {
  VisualIntelligenceAnalyzeSchema,
  VisualIntelligenceCancelSchema,
} from '../../src/shared/ipc/schemas';
import { DEFAULT_VISUAL_INTELLIGENCE_CONFIG } from '../../src/shared/visual-intelligence/types';

function frame(id: string, hash = id): VisualFrame {
  const bytes = new Uint8Array(64).fill(7);
  return {
    id,
    timestamp: Date.now(),
    width: 640,
    height: 360,
    mimeType: 'image/png',
    byteSize: bytes.byteLength,
    source: 'DISPLAY',
    sourceId: 'd1',
    contentHash: hash,
    captureDurationMs: 1,
    status: 'accepted',
    bytes,
  };
}

function question(type: DetectedQuestion['type'], text: string): DetectedQuestion {
  return {
    id: `q-${type}`,
    text,
    originalText: text,
    normalizedText: text.toLowerCase(),
    type,
    status: 'classified',
    timestamp: Date.now(),
    sourceSegmentIds: ['s1'],
    detectionConfidence: 0.9,
    classificationConfidence: 0.85,
    isMultiPart: false,
    parts: [],
    parentQuestionId: null,
    relatedQuestionId: null,
  };
}

const enabledConfig = {
  ...DEFAULT_VISUAL_INTELLIGENCE_CONFIG,
  enabled: true,
  ocr: { ...DEFAULT_VISUAL_INTELLIGENCE_CONFIG.ocr, provider: 'mock' as const },
  vision: { ...DEFAULT_VISUAL_INTELLIGENCE_CONFIG.vision, provider: 'mock' as const },
};

describe('OCR normalization', () => {
  it('collapses whitespace, duplicates, and enforces character limits', () => {
    const input = 'line one\nline one\n\n\nline  two   \n\n\nend';
    const normalized = normalizeOCRText(input, 20);
    expect(normalized).not.toMatch(/\n{3,}/);
    expect(normalized.split('\n').filter((line) => line === 'line one').length).toBe(1);
    expect(normalized.length).toBeLessThanOrEqual(40);
    expect(normalized).toContain('…[ocr truncated]');
  });

  it('preserves code punctuation', () => {
    const code = 'function foo(a: string): boolean {\n  return a === "x";\n}';
    expect(normalizeOCRText(code, 500)).toContain('===');
    expect(normalizeOCRText(code, 500)).toContain('{');
  });
});

describe('MockOCRProvider', () => {
  it('returns deterministic success text', async () => {
    const provider = new MockOCRProvider();
    const result = await provider.recognize(frame('f1'), 'r1');
    expect(result.status).toBe('completed');
    expect(result.text).toContain('example text');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('supports empty, failure, timeout, and cancellation', async () => {
    const provider = new MockOCRProvider();
    provider.setMode('empty');
    expect((await provider.recognize(frame('f2'), 'r2')).status).toBe('empty');

    provider.setMode('failure');
    await expect(provider.recognize(frame('f3'), 'r3')).rejects.toMatchObject({
      details: { code: 'OCR_FAILED' },
    });

    provider.setMode('timeout');
    await expect(provider.recognize(frame('f4'), 'r4')).rejects.toMatchObject({
      details: { code: 'OCR_TIMEOUT' },
    });

    provider.setMode('success');
    provider.setDelayMs(30);
    const pending = provider.recognize(frame('f5'), 'cancel-me');
    await provider.cancel('cancel-me');
    const cancelled = await pending;
    expect(cancelled.status).toBe('cancelled');
  });
});

describe('MockVisionProvider', () => {
  it('returns structured success and unknown modes', async () => {
    const provider = new MockVisionProvider();
    const ok = await provider.analyze({
      requestId: 'v1',
      frameId: 'f1',
      mimeType: 'image/png',
      imageBase64: 'aaaa',
      width: 10,
      height: 10,
      mode: 'technical',
    });
    expect(ok.contentType).toBe('CODE');
    expect(ok.technicalElements.length).toBeGreaterThan(0);

    provider.setMode('unknown');
    const unknown = await provider.analyze({
      requestId: 'v2',
      frameId: 'f1',
      mimeType: 'image/png',
      imageBase64: 'aaaa',
      width: 10,
      height: 10,
      mode: 'general',
    });
    expect(unknown.contentType).toBe('UNKNOWN');
  });

  it('supports failure, timeout, and cancellation', async () => {
    const provider = new MockVisionProvider();
    provider.setMode('failure');
    await expect(
      provider.analyze({
        requestId: 'v3',
        frameId: 'f1',
        mimeType: 'image/png',
        imageBase64: 'a',
        width: 1,
        height: 1,
        mode: 'general',
      }),
    ).rejects.toMatchObject({ details: { code: 'VISION_FAILED' } });

    provider.setMode('timeout');
    await expect(
      provider.analyze({
        requestId: 'v4',
        frameId: 'f1',
        mimeType: 'image/png',
        imageBase64: 'a',
        width: 1,
        height: 1,
        mode: 'general',
      }),
    ).rejects.toMatchObject({ details: { code: 'VISION_TIMEOUT' } });

    provider.setMode('success');
    provider.setDelayMs(30);
    const pending = provider.analyze({
      requestId: 'cancel-v',
      frameId: 'f1',
      mimeType: 'image/png',
      imageBase64: 'a',
      width: 1,
      height: 1,
      mode: 'general',
    });
    await provider.cancel('cancel-v');
    expect((await pending).status).toBe('cancelled');
  });
});

describe('VisualRelevanceEvaluator', () => {
  const evaluator = new RuleBasedVisualRelevanceEvaluator();

  it('marks technical/coding/architecture questions relevant', () => {
    expect(evaluator.evaluate(question('coding', 'Fix this function'))).toBe('RELEVANT');
    expect(evaluator.evaluate(question('architecture', 'Explain this diagram'))).toBe('RELEVANT');
    expect(evaluator.evaluate(question('technical', 'What does this error mean'))).toBe('RELEVANT');
  });

  it('marks behavioral/general as not relevant unless keywords appear', () => {
    expect(evaluator.evaluate(question('behavioral', 'Tell me about a challenge'))).toBe(
      'NOT_RELEVANT',
    );
    expect(evaluator.evaluate(question('general', 'How are you today'))).toBe('NOT_RELEVANT');
    expect(evaluator.evaluate(question('general', 'What is on the screen'))).toBe('RELEVANT');
  });

  it('returns UNKNOWN without a question', () => {
    expect(evaluator.evaluate(null)).toBe('UNKNOWN');
  });
});

class UnavailableOCR implements OCRProvider {
  async getCapabilities(): Promise<OCRCapabilities> {
    return {
      available: 'NOT_CONFIGURED',
      providerName: 'none-ocr',
      supportedLanguages: [],
      supportsBoundingBoxes: false,
      maxImageBytes: 1,
      maxWidth: 1,
      maxHeight: 1,
    };
  }
  async recognize(): Promise<OCRResult> {
    throw new AppError('CONFIGURATION', 'OCR not configured', {
      details: { code: 'OCR_NOT_CONFIGURED' },
    });
  }
  async cancel(): Promise<void> {}
}

class UnavailableVision implements VisionProvider {
  async getCapabilities(): Promise<VisionCapabilities> {
    return {
      available: 'UNSUPPORTED',
      providerName: 'none-vision',
      supportsImageInput: false,
      supportsOCRContext: false,
      supportsStructuredOutput: false,
      maxImageBytes: 1,
      maxWidth: 1,
      maxHeight: 1,
    };
  }
  async analyze(_request: VisionAnalysisRequest): Promise<VisionAnalysis> {
    throw new AppError('PROVIDER', 'Vision unavailable', {
      details: { code: 'VISION_PROVIDER_UNAVAILABLE' },
    });
  }
  async cancel(): Promise<void> {}
}

describe('VisualIntelligencePipeline', () => {
  it('runs frame → OCR → vision', async () => {
    const ocr = new MockOCRProvider();
    const vision = new MockVisionProvider();
    const recorded: Array<{ frameId: string }> = [];
    const pipeline = new VisualIntelligencePipeline({
      ocrProvider: ocr,
      visionProvider: vision,
      getConfig: () => enabledConfig,
      onResults: (input) => recorded.push({ frameId: input.frameId }),
    });

    const result = await pipeline.analyzeFrame({
      frame: frame('pipe-1'),
      question: question('coding', 'What does this code do?'),
      force: true,
    });
    expect(result.skipped).toBe(false);
    expect(result.ocr?.status).toBe('completed');
    expect(result.vision?.contentType).toBe('CODE');
    expect(recorded).toHaveLength(1);
  });

  it('skips duplicate frames and not-relevant questions', async () => {
    const pipeline = new VisualIntelligencePipeline({
      ocrProvider: new MockOCRProvider(),
      visionProvider: new MockVisionProvider(),
      getConfig: () => enabledConfig,
    });
    await pipeline.analyzeFrame({ frame: frame('dup', 'hash-a'), force: true });
    const dup = await pipeline.analyzeFrame({ frame: frame('dup-2', 'hash-a'), force: false });
    expect(dup.skipped).toBe(true);
    expect(dup.skipReason).toBe('duplicate_frame');

    const skipped = await pipeline.analyzeFrame({
      frame: frame('beh', 'hash-b'),
      question: question('behavioral', 'Tell me about teamwork'),
      force: false,
    });
    expect(skipped.skipped).toBe(true);
    expect(skipped.skipReason).toBe('not_relevant');
  });

  it('supports OCR-only and vision-only availability', async () => {
    const ocrOnly = new VisualIntelligencePipeline({
      ocrProvider: new MockOCRProvider(),
      visionProvider: new UnavailableVision(),
      getConfig: () => ({
        ...enabledConfig,
        vision: { ...enabledConfig.vision, enabled: false },
      }),
    });
    const ocrResult = await ocrOnly.analyzeFrame({ frame: frame('ocr-only'), force: true });
    expect(ocrResult.ocr?.status).toBe('completed');
    expect(ocrResult.vision).toBeNull();

    const visionOnly = new VisualIntelligencePipeline({
      ocrProvider: new UnavailableOCR(),
      visionProvider: new MockVisionProvider(),
      getConfig: () => ({
        ...enabledConfig,
        ocr: { ...enabledConfig.ocr, enabled: false },
      }),
    });
    const visionResult = await visionOnly.analyzeFrame({
      frame: frame('vision-only'),
      force: true,
    });
    expect(visionResult.ocr).toBeNull();
    expect(visionResult.vision?.status).toBe('completed');
  });

  it('fails when both providers unavailable', async () => {
    const pipeline = new VisualIntelligencePipeline({
      ocrProvider: new UnavailableOCR(),
      visionProvider: new UnavailableVision(),
      getConfig: () => enabledConfig,
    });
    await expect(
      pipeline.analyzeFrame({ frame: frame('none'), force: true }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('cancels an in-flight analysis', async () => {
    const ocr = new MockOCRProvider();
    ocr.setDelayMs(80);
    const pipeline = new VisualIntelligencePipeline({
      ocrProvider: ocr,
      visionProvider: new MockVisionProvider(),
      getConfig: () => ({ ...enabledConfig, analysisTimeoutMs: 5_000 }),
    });
    const pending = pipeline.analyzeFrame({ frame: frame('cancel-pipe'), force: true });
    await pipeline.cancel();
    await expect(pending).rejects.toMatchObject({
      details: { code: 'VISUAL_ANALYSIS_CANCELLED' },
    });
  });
});

describe('Context integration with OCR/vision', () => {
  it('inserts visual analysis and OCR, dedupes overlapping OCR, and truncates', () => {
    const builder = new ContextBuilder({ idGenerator: () => 'ctx-vi' });
    const longOcr = 'x'.repeat(5000);
    const snapshot = builder.build({
      currentQuestion: question('coding', 'Explain this'),
      questionHistory: [],
      transcriptSegments: [],
      budget: {
        maxTranscriptSegments: 2,
        maxTranscriptCharacters: 100,
        maxQuestionCount: 2,
        maxRelatedQuestions: 1,
        maxContextCharacters: 800,
        maxRecentSnapshots: 5,
      },
      visualContext: {
        frames: [
          {
            id: 'f1',
            timestamp: 1,
            width: 10,
            height: 10,
            mimeType: 'image/png',
            byteSize: 32,
            source: 'DISPLAY',
            sourceId: 'd1',
            contentHash: 'h1',
            captureDurationMs: 1,
            status: 'accepted',
          },
        ],
        latestFrame: null,
        capturedAt: 1,
        source: 'DISPLAY',
        ocrResults: [
          {
            id: 'o1',
            sourceFrameId: 'f1',
            text: 'function authenticate() { return true; }',
            confidence: 0.9,
            language: 'en',
            status: 'completed',
            createdAt: 1,
            processingTimeMs: 10,
          },
          {
            id: 'o2',
            sourceFrameId: 'f1',
            text: longOcr,
            confidence: 0.5,
            language: 'en',
            status: 'completed',
            createdAt: 2,
            processingTimeMs: 10,
          },
        ],
        visionAnalyses: [
          {
            id: 'v1',
            sourceFrameId: 'f1',
            description: 'Code screenshot',
            contentType: 'CODE',
            confidence: 0.9,
            relevantText: 'function authenticate() { return true; }',
            technicalElements: [{ kind: 'function', value: 'authenticate', confidence: 0.8 }],
            detectedEntities: ['authenticate'],
            warnings: [],
            status: 'completed',
            createdAt: 1,
            processingTimeMs: 20,
          },
        ],
        metadata: {
          frameCount: 1,
          discardedCount: 0,
          truncated: false,
          approximatePayloadBytes: 32,
          source: 'DISPLAY',
          visualFrameCount: 1,
          ocrResultCount: 2,
          visionAnalysisCount: 1,
          discardedFrameCount: 0,
          payloadBytes: 32,
        },
      },
    });

    expect(snapshot.visualContext).not.toBeNull();
    expect(snapshot.metadata.sources).toContain('visual_context');
    expect(snapshot.metadata.visionAnalysisCount).toBeGreaterThan(0);
    // OCR duplicated in vision relevantText should be filtered.
    const ocrTexts = snapshot.visualContext?.ocrResults.map((item) => item.text) ?? [];
    expect(ocrTexts.some((text) => text.includes('function authenticate'))).toBe(false);
    expect(snapshot.metadata.characterCount).toBeLessThanOrEqual(800);
  });
});

describe('Visual intelligence IPC contracts', () => {
  it('validates analyze/cancel payloads', () => {
    expect(VisualIntelligenceAnalyzeSchema.safeParse({ force: true }).success).toBe(true);
    expect(VisualIntelligenceAnalyzeSchema.safeParse({}).success).toBe(true);
    expect(VisualIntelligenceCancelSchema.safeParse({ requestId: 'abc' }).success).toBe(true);
    expect(VisualIntelligenceCancelSchema.safeParse({ requestId: '' }).success).toBe(false);
  });

  it('keeps error payloads free of image/secret material', () => {
    const payload = toSafeErrorPayload(
      new AppError('PROVIDER', 'OCR failed', { details: { code: 'OCR_FAILED' } }),
    );
    expect(payload.details?.code).toBe('OCR_FAILED');
    expect(JSON.stringify(payload)).not.toMatch(/base64|apiKey|sk-/i);
  });
});
