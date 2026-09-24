import OpenAI from 'openai';
import type {
  VisionAnalysis,
  VisionAnalysisRequest,
  VisionCapabilities,
  VisionContentType,
  VisionTechnicalElement,
} from '../../shared/vision/types';
import { AppError } from '../../shared/errors';
import { createDefaultIdGenerator } from '../../shared/session/types';
import type { VisionProvider } from '../../core/vision/VisionProvider';
import { AI_OPENAI_CREDENTIAL_KEY } from '../../shared/ai/types';

export interface OpenAIVisionProviderOptions {
  getApiKey: () => Promise<string | null>;
  model: string;
  timeoutMs?: number;
}

const CONTENT_TYPES: VisionContentType[] = [
  'CODE',
  'ERROR_MESSAGE',
  'TERMINAL',
  'DIAGRAM',
  'ARCHITECTURE',
  'UI',
  'TABLE',
  'DOCUMENT',
  'PRESENTATION',
  'IMAGE',
  'UNKNOWN',
];

/**
 * Structured vision analysis via OpenAI.
 * Main-process only — reuses CredentialVault key ai.openai.apiKey.
 */
export class OpenAIVisionProvider implements VisionProvider {
  private readonly createId = createDefaultIdGenerator();
  private readonly getApiKey: () => Promise<string | null>;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(options: OpenAIVisionProviderOptions) {
    this.getApiKey = options.getApiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  async getCapabilities(): Promise<VisionCapabilities> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return {
        available: 'NOT_CONFIGURED',
        providerName: 'openai-vision',
        supportsImageInput: true,
        supportsOCRContext: true,
        supportsStructuredOutput: true,
        maxImageBytes: 1_500_000,
        maxWidth: 1280,
        maxHeight: 720,
      };
    }
    return {
      available: 'SUPPORTED',
      providerName: 'openai-vision',
      supportsImageInput: true,
      supportsOCRContext: true,
      supportsStructuredOutput: true,
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

  async analyze(request: VisionAnalysisRequest): Promise<VisionAnalysis> {
    const started = Date.now();
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new AppError('CONFIGURATION', 'OpenAI API key is not configured for vision', {
        details: { code: 'VISION_NOT_CONFIGURED', credentialKey: AI_OPENAI_CREDENTIAL_KEY },
      });
    }

    const controller = new AbortController();
    this.abortControllers.set(request.requestId, controller);
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const client = new OpenAI({ apiKey });
      const dataUrl = `data:${request.mimeType};base64,${request.imageBase64}`;
      const contextBits = [
        request.questionText ? `Question: ${request.questionText.slice(0, 500)}` : null,
        request.questionType ? `Question type: ${request.questionType}` : null,
        request.ocrText ? `OCR text (bounded):\n${request.ocrText.slice(0, 2000)}` : null,
        request.relevantTranscript
          ? `Relevant transcript:\n${request.relevantTranscript.slice(0, 800)}`
          : null,
      ]
        .filter(Boolean)
        .join('\n\n');

      const completion = await client.chat.completions.create(
        {
          model: this.model,
          temperature: 0.2,
          max_tokens: 1200,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: [
                'Analyze the screenshot for an interview assistance tool.',
                'Return JSON with keys: description (string), contentType (one of CODE,ERROR_MESSAGE,TERMINAL,DIAGRAM,ARCHITECTURE,UI,TABLE,DOCUMENT,PRESENTATION,IMAGE,UNKNOWN), confidence (0-1), relevantText (string), technicalElements (array of {kind,value,confidence}), detectedEntities (string[]), warnings (string[]).',
                'Do not invent technical details. Use UNKNOWN when unsure. Prefer low confidence over fabrication.',
              ].join(' '),
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Mode: ${request.mode}\n${contextBits || 'No additional text context.'}`,
                },
                { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
              ],
            },
          ],
        },
        { signal: controller.signal },
      );

      if (controller.signal.aborted) {
        return cancelledAnalysis(this.createId(), request.frameId, started);
      }

      const raw = completion.choices[0]?.message?.content ?? '{}';
      return parseVisionJson(raw, this.createId(), request.frameId, started, request.ocrText);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AppError('PROVIDER', 'Vision timed out or was cancelled', {
          details: { code: 'VISION_TIMEOUT' },
          cause: error,
        });
      }
      throw mapOpenAiVisionError(error);
    } finally {
      clearTimeout(timer);
      this.abortControllers.delete(request.requestId);
    }
  }
}

function cancelledAnalysis(id: string, frameId: string, started: number): VisionAnalysis {
  return {
    id,
    sourceFrameId: frameId,
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

function parseVisionJson(
  raw: string,
  id: string,
  frameId: string,
  started: number,
  ocrText?: string | null,
): VisionAnalysis {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {
      id,
      sourceFrameId: frameId,
      description: 'Vision response was not valid JSON.',
      contentType: 'UNKNOWN',
      confidence: 0,
      relevantText: ocrText ?? '',
      technicalElements: [],
      detectedEntities: [],
      warnings: ['invalid_json'],
      processingTimeMs: Date.now() - started,
      createdAt: Date.now(),
      status: 'completed',
    };
  }

  const contentTypeRaw = String(parsed.contentType ?? 'UNKNOWN').toUpperCase();
  const contentType = CONTENT_TYPES.includes(contentTypeRaw as VisionContentType)
    ? (contentTypeRaw as VisionContentType)
    : 'UNKNOWN';
  const confidence = clamp01(Number(parsed.confidence ?? 0));
  const technicalElements = Array.isArray(parsed.technicalElements)
    ? parsed.technicalElements
        .map((item): VisionTechnicalElement | null => {
          if (!item || typeof item !== 'object') return null;
          const row = item as Record<string, unknown>;
          const value = String(row.value ?? '').trim();
          if (!value) return null;
          return {
            kind: String(row.kind ?? 'unknown').slice(0, 64),
            value: value.slice(0, 200),
            confidence: clamp01(Number(row.confidence ?? 0)),
          };
        })
        .filter((item): item is VisionTechnicalElement => item !== null)
        .slice(0, 24)
    : [];

  return {
    id,
    sourceFrameId: frameId,
    description: String(parsed.description ?? '').slice(0, 1200),
    contentType: confidence < 0.35 ? 'UNKNOWN' : contentType,
    confidence,
    relevantText: String(parsed.relevantText ?? ocrText ?? '').slice(0, 4000),
    technicalElements,
    detectedEntities: Array.isArray(parsed.detectedEntities)
      ? parsed.detectedEntities.map((item) => String(item).slice(0, 120)).slice(0, 40)
      : [],
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map((item) => String(item).slice(0, 120)).slice(0, 20)
      : [],
    processingTimeMs: Date.now() - started,
    createdAt: Date.now(),
    status: 'completed',
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function mapOpenAiVisionError(error: unknown): AppError {
  const message = error instanceof Error ? error.message : 'Vision failed';
  if (/unsupported|invalid.?image|image.?format/i.test(message)) {
    return new AppError('PROVIDER', 'Unsupported image for vision', {
      details: { code: 'VISION_UNSUPPORTED_IMAGE' },
      cause: error,
    });
  }
  if (/timeout|ETIMEDOUT|aborted/i.test(message)) {
    return new AppError('PROVIDER', 'Vision timed out', {
      details: { code: 'VISION_TIMEOUT' },
      cause: error,
    });
  }
  if (/401|unauthorized|invalid.?api.?key/i.test(message)) {
    return new AppError('AUTHENTICATION', 'Vision authentication failed', {
      details: { code: 'VISION_NOT_CONFIGURED' },
      cause: error,
    });
  }
  return new AppError('PROVIDER', 'Vision analysis failed', {
    details: { code: 'VISION_FAILED' },
    cause: error,
  });
}
