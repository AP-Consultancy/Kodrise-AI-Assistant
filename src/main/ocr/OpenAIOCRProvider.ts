import OpenAI from 'openai';
import type { VisualFrame } from '../../shared/visual-context/types';
import type { OCRCapabilities, OCRResult } from '../../shared/ocr/types';
import { AppError } from '../../shared/errors';
import { createDefaultIdGenerator } from '../../shared/session/types';
import type { OCRProvider } from '../../core/ocr/OCRProvider';
import { normalizeOCRText } from '../../core/ocr/normalizeOCRText';
import { AI_OPENAI_CREDENTIAL_KEY } from '../../shared/ai/types';

export interface OpenAIOCRProviderOptions {
  getApiKey: () => Promise<string | null>;
  model: string;
  maxCharacters: number;
  timeoutMs?: number;
}

/**
 * OCR via OpenAI vision-capable chat completions.
 * Main-process only — reuses CredentialVault key ai.openai.apiKey.
 */
export class OpenAIOCRProvider implements OCRProvider {
  private readonly createId = createDefaultIdGenerator();
  private readonly getApiKey: () => Promise<string | null>;
  private readonly model: string;
  private readonly maxCharacters: number;
  private readonly timeoutMs: number;
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(options: OpenAIOCRProviderOptions) {
    this.getApiKey = options.getApiKey;
    this.model = options.model;
    this.maxCharacters = options.maxCharacters;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async getCapabilities(): Promise<OCRCapabilities> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return {
        available: 'NOT_CONFIGURED',
        providerName: 'openai-ocr',
        supportedLanguages: ['en'],
        supportsBoundingBoxes: false,
        maxImageBytes: 1_500_000,
        maxWidth: 1280,
        maxHeight: 720,
      };
    }
    return {
      available: 'SUPPORTED',
      providerName: 'openai-ocr',
      supportedLanguages: ['en'],
      supportsBoundingBoxes: false,
      maxImageBytes: 1_500_000,
      maxWidth: 1280,
      maxHeight: 720,
    };
  }

  async cancel(requestId: string): Promise<void> {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(requestId);
    }
  }

  async recognize(frame: VisualFrame, requestId: string): Promise<OCRResult> {
    const started = Date.now();
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new AppError('CONFIGURATION', 'OpenAI API key is not configured for OCR', {
        details: { code: 'OCR_NOT_CONFIGURED', credentialKey: AI_OPENAI_CREDENTIAL_KEY },
      });
    }

    const controller = new AbortController();
    this.abortControllers.set(requestId, controller);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const client = new OpenAI({ apiKey });
      const dataUrl = `data:${frame.mimeType};base64,${Buffer.from(frame.bytes).toString('base64')}`;
      const completion = await client.chat.completions.create(
        {
          model: this.model,
          temperature: 0,
          max_tokens: 2000,
          messages: [
            {
              role: 'system',
              content:
                'Extract all readable text from the image exactly as shown. Preserve code punctuation, brackets, and indentation. Return plain text only — no commentary.',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Extract text from this image.' },
                { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
              ],
            },
          ],
        },
        { signal: controller.signal },
      );

      if (controller.signal.aborted) {
        return emptyResult(this.createId(), frame.id, started, 'cancelled');
      }

      const raw = completion.choices[0]?.message?.content?.trim() ?? '';
      const text = normalizeOCRText(raw, this.maxCharacters);
      return {
        id: this.createId(),
        sourceFrameId: frame.id,
        text,
        confidence: text ? 0.75 : 0,
        language: 'en',
        processingTimeMs: Date.now() - started,
        createdAt: Date.now(),
        boundingRegions: [],
        status: text ? 'completed' : 'empty',
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AppError('PROVIDER', 'OCR timed out or was cancelled', {
          details: { code: 'OCR_TIMEOUT' },
          cause: error,
        });
      }
      throw mapOpenAiOcrError(error);
    } finally {
      clearTimeout(timer);
      this.abortControllers.delete(requestId);
    }
  }
}

function emptyResult(
  id: string,
  frameId: string,
  started: number,
  status: 'empty' | 'cancelled',
): OCRResult {
  return {
    id,
    sourceFrameId: frameId,
    text: '',
    confidence: 0,
    language: 'en',
    processingTimeMs: Date.now() - started,
    createdAt: Date.now(),
    boundingRegions: [],
    status,
  };
}

function mapOpenAiOcrError(error: unknown): AppError {
  const message = error instanceof Error ? error.message : 'OCR failed';
  if (/401|unauthorized|invalid.?api.?key/i.test(message)) {
    return new AppError('AUTHENTICATION', 'OCR authentication failed', {
      details: { code: 'OCR_PERMISSION_DENIED' },
      cause: error,
    });
  }
  if (/timeout|ETIMEDOUT|aborted/i.test(message)) {
    return new AppError('PROVIDER', 'OCR timed out', {
      details: { code: 'OCR_TIMEOUT' },
      cause: error,
    });
  }
  return new AppError('PROVIDER', 'OCR failed', {
    details: { code: 'OCR_FAILED' },
    cause: error,
  });
}
