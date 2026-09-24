import type { VisualFrame } from '../../shared/visual-context/types';
import type { OCRCapabilities, OCRResult } from '../../shared/ocr/types';
import { AppError } from '../../shared/errors';
import { createDefaultIdGenerator } from '../../shared/session/types';
import type { OCRProvider } from './OCRProvider';
import { normalizeOCRText } from './normalizeOCRText';

export class MockOCRProvider implements OCRProvider {
  private readonly createId = createDefaultIdGenerator();
  private readonly cancelled = new Set<string>();
  private mode: 'success' | 'empty' | 'failure' | 'timeout' = 'success';
  private delayMs = 0;
  private maxCharacters = 4000;

  setMode(mode: 'success' | 'empty' | 'failure' | 'timeout'): void {
    this.mode = mode;
  }

  setDelayMs(ms: number): void {
    this.delayMs = ms;
  }

  setMaxCharacters(value: number): void {
    this.maxCharacters = value;
  }

  async getCapabilities(): Promise<OCRCapabilities> {
    return {
      available: 'SUPPORTED',
      providerName: 'mock-ocr',
      supportedLanguages: ['en'],
      supportsBoundingBoxes: true,
      maxImageBytes: 1_500_000,
      maxWidth: 1280,
      maxHeight: 720,
    };
  }

  async cancel(requestId: string): Promise<void> {
    this.cancelled.add(requestId);
  }

  async recognize(frame: VisualFrame, requestId: string): Promise<OCRResult> {
    const started = Date.now();
    if (this.delayMs > 0) {
      await delay(this.delayMs);
    }
    if (this.cancelled.has(requestId)) {
      return {
        id: this.createId(),
        sourceFrameId: frame.id,
        text: '',
        confidence: 0,
        language: 'en',
        processingTimeMs: Date.now() - started,
        createdAt: Date.now(),
        boundingRegions: [],
        status: 'cancelled',
      };
    }
    if (this.mode === 'timeout') {
      throw new AppError('PROVIDER', 'OCR timed out', { details: { code: 'OCR_TIMEOUT' } });
    }
    if (this.mode === 'failure') {
      throw new AppError('PROVIDER', 'OCR failed', { details: { code: 'OCR_FAILED' } });
    }
    if (this.mode === 'empty') {
      return {
        id: this.createId(),
        sourceFrameId: frame.id,
        text: '',
        confidence: 0,
        language: 'en',
        processingTimeMs: Date.now() - started,
        createdAt: Date.now(),
        boundingRegions: [],
        status: 'empty',
      };
    }

    const raw = `example text from frame ${frame.id}\nfunction authenticate() {\n  return true;\n}`;
    const text = normalizeOCRText(raw, this.maxCharacters);
    return {
      id: this.createId(),
      sourceFrameId: frame.id,
      text,
      confidence: 0.95,
      language: 'en',
      processingTimeMs: Date.now() - started,
      createdAt: Date.now(),
      boundingRegions: [
        { x: 0, y: 0, width: frame.width, height: 24, confidence: 0.9, text: 'example text' },
      ],
      status: 'completed',
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
