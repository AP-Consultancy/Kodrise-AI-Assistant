import type {
  VisionAnalysis,
  VisionAnalysisRequest,
  VisionCapabilities,
} from '../../shared/vision/types';
import { AppError } from '../../shared/errors';
import { createDefaultIdGenerator } from '../../shared/session/types';
import type { VisionProvider } from './VisionProvider';

export class MockVisionProvider implements VisionProvider {
  private readonly createId = createDefaultIdGenerator();
  private readonly cancelled = new Set<string>();
  private mode: 'success' | 'unknown' | 'failure' | 'timeout' = 'success';
  private delayMs = 0;

  setMode(mode: 'success' | 'unknown' | 'failure' | 'timeout'): void {
    this.mode = mode;
  }

  setDelayMs(ms: number): void {
    this.delayMs = ms;
  }

  async getCapabilities(): Promise<VisionCapabilities> {
    return {
      available: 'SUPPORTED',
      providerName: 'mock-vision',
      supportsImageInput: true,
      supportsOCRContext: true,
      supportsStructuredOutput: true,
      maxImageBytes: 1_500_000,
      maxWidth: 1280,
      maxHeight: 720,
    };
  }

  async cancel(requestId: string): Promise<void> {
    this.cancelled.add(requestId);
  }

  async analyze(request: VisionAnalysisRequest): Promise<VisionAnalysis> {
    const started = Date.now();
    if (this.delayMs > 0) {
      await delay(this.delayMs);
    }
    if (this.cancelled.has(request.requestId)) {
      return {
        id: this.createId(),
        sourceFrameId: request.frameId,
        description: '',
        contentType: 'UNKNOWN',
        confidence: 0,
        relevantText: '',
        technicalElements: [],
        detectedEntities: [],
        warnings: ['cancelled'],
        processingTimeMs: Date.now() - started,
        createdAt: Date.now(),
        status: 'cancelled',
      };
    }
    if (this.mode === 'timeout') {
      throw new AppError('PROVIDER', 'Vision timed out', { details: { code: 'VISION_TIMEOUT' } });
    }
    if (this.mode === 'failure') {
      throw new AppError('PROVIDER', 'Vision failed', { details: { code: 'VISION_FAILED' } });
    }
    if (this.mode === 'unknown') {
      return {
        id: this.createId(),
        sourceFrameId: request.frameId,
        description: 'Unable to determine visual content confidently.',
        contentType: 'UNKNOWN',
        confidence: 0.2,
        relevantText: request.ocrText ?? '',
        technicalElements: [],
        detectedEntities: [],
        warnings: ['low_confidence'],
        processingTimeMs: Date.now() - started,
        createdAt: Date.now(),
        status: 'completed',
      };
    }

    return {
      id: this.createId(),
      sourceFrameId: request.frameId,
      description: 'Mock analysis: technical code screenshot with authentication function.',
      contentType: 'CODE',
      confidence: 0.9,
      relevantText: request.ocrText ?? 'function authenticate() { return true; }',
      technicalElements: [
        { kind: 'language', value: 'javascript', confidence: 0.8 },
        { kind: 'function', value: 'authenticate', confidence: 0.85 },
      ],
      detectedEntities: ['authenticate'],
      warnings: [],
      processingTimeMs: Date.now() - started,
      createdAt: Date.now(),
      status: 'completed',
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
