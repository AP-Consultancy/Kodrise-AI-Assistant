import type { VisualFrame } from '../../shared/visual-context/types';
import type { OCRResult } from '../../shared/ocr/types';
import type { VisionAnalysis } from '../../shared/vision/types';
import type { DetectedQuestion } from '../../shared/questions/types';
import type {
  VisualIntelligenceEvent,
  VisualIntelligencePublicConfig,
  VisualIntelligenceState,
  VisualIntelligenceStatus,
  VisualRelevance,
} from '../../shared/visual-intelligence/types';
import { DEFAULT_VISUAL_INTELLIGENCE_CONFIG } from '../../shared/visual-intelligence/types';
import { AppError, toSafeErrorPayload } from '../../shared/errors';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';
import type { OCRProvider } from '../ocr/OCRProvider';
import type { VisionProvider } from '../vision/VisionProvider';
import type { VisualRelevanceEvaluator } from './VisualRelevanceEvaluator';
import { RuleBasedVisualRelevanceEvaluator } from './VisualRelevanceEvaluator';

export type VisualIntelligenceListener = (event: VisualIntelligenceEvent) => void;

export interface VisualIntelligencePipelineOptions {
  ocrProvider: OCRProvider;
  visionProvider: VisionProvider;
  getConfig?: () => VisualIntelligencePublicConfig;
  relevanceEvaluator?: VisualRelevanceEvaluator;
  idGenerator?: IdGenerator;
  onLog?: (event: string, meta: Record<string, unknown>) => void;
  /** Persist OCR/vision into visual context store. */
  onResults?: (input: {
    frameId: string;
    ocr: OCRResult | null;
    vision: VisionAnalysis | null;
  }) => void;
}

export interface AnalyzeFrameInput {
  frame: VisualFrame;
  question?: DetectedQuestion | null;
  relevantTranscript?: string | null;
  /** Force analysis even if relevance says NOT_RELEVANT. */
  force?: boolean;
}

export interface AnalyzeFrameResult {
  requestId: string;
  frameId: string;
  relevance: VisualRelevance;
  skipped: boolean;
  skipReason?: string;
  ocr: OCRResult | null;
  vision: VisionAnalysis | null;
  processingTimeMs: number;
}

/**
 * Frame → OCR → Vision → structured visual intelligence.
 * Does not own capture or AI answer generation.
 */
export class VisualIntelligencePipeline {
  private readonly ocrProvider: OCRProvider;
  private readonly visionProvider: VisionProvider;
  private readonly getConfig: () => VisualIntelligencePublicConfig;
  private readonly relevance: VisualRelevanceEvaluator;
  private readonly createId: IdGenerator;
  private readonly onLog: (event: string, meta: Record<string, unknown>) => void;
  private readonly onResults:
    | ((input: { frameId: string; ocr: OCRResult | null; vision: VisionAnalysis | null }) => void)
    | null;
  private readonly listeners = new Set<VisualIntelligenceListener>();
  private readonly analysedHashes = new Map<string, number>();
  private readonly activeByFrame = new Set<string>();

  private state: VisualIntelligenceState = 'idle';
  private activeRequestId: string | null = null;
  private cancelRequested = false;
  private lastOcrAt: number | null = null;
  private lastVisionAt: number | null = null;
  private lastProcessingTimeMs: number | null = null;
  private lastErrorCode: string | null = null;
  private lastErrorMessage: string | null = null;
  private ocrResultCount = 0;
  private visionAnalysisCount = 0;
  private ocrAvailable = 'UNKNOWN';
  private visionAvailable = 'UNKNOWN';
  private ocrProviderName = 'unknown';
  private visionProviderName = 'unknown';

  constructor(options: VisualIntelligencePipelineOptions) {
    this.ocrProvider = options.ocrProvider;
    this.visionProvider = options.visionProvider;
    this.getConfig = options.getConfig ?? (() => structuredClone(DEFAULT_VISUAL_INTELLIGENCE_CONFIG));
    this.relevance = options.relevanceEvaluator ?? new RuleBasedVisualRelevanceEvaluator();
    this.createId = options.idGenerator ?? createDefaultIdGenerator();
    this.onLog = options.onLog ?? (() => undefined);
    this.onResults = options.onResults ?? null;
  }

  subscribe(listener: VisualIntelligenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refreshCapabilities(): Promise<void> {
    const [ocr, vision] = await Promise.all([
      this.ocrProvider.getCapabilities(),
      this.visionProvider.getCapabilities(),
    ]);
    this.ocrAvailable = ocr.available;
    this.visionAvailable = vision.available;
    this.ocrProviderName = ocr.providerName;
    this.visionProviderName = vision.providerName;
  }

  getStatus(): VisualIntelligenceStatus {
    const config = this.getConfig();
    return {
      enabled: config.enabled,
      state: this.state,
      ocrEnabled: config.ocr.enabled,
      visionEnabled: config.vision.enabled,
      ocrProvider: this.ocrProviderName,
      visionProvider: this.visionProviderName,
      ocrAvailable: this.ocrAvailable,
      visionAvailable: this.visionAvailable,
      model: config.vision.model,
      lastOcrAt: this.lastOcrAt,
      lastVisionAt: this.lastVisionAt,
      lastProcessingTimeMs: this.lastProcessingTimeMs,
      lastErrorCode: this.lastErrorCode,
      lastErrorMessage: this.lastErrorMessage,
      ocrResultCount: this.ocrResultCount,
      visionAnalysisCount: this.visionAnalysisCount,
      activeRequestId: this.activeRequestId,
    };
  }

  async cancel(requestId?: string): Promise<void> {
    if (requestId && this.activeRequestId && requestId !== this.activeRequestId) {
      return;
    }
    this.cancelRequested = true;
    const active = this.activeRequestId;
    if (active) {
      await Promise.allSettled([
        this.ocrProvider.cancel(active),
        this.visionProvider.cancel(active),
      ]);
    }
    this.state = 'cancelled';
    this.emit({
      type: 'visual.intelligence.updated',
      timestamp: Date.now(),
      requestId: active ?? undefined,
      code: 'VISUAL_ANALYSIS_CANCELLED',
    });
  }

  clearResults(): void {
    this.ocrResultCount = 0;
    this.visionAnalysisCount = 0;
    this.analysedHashes.clear();
    this.lastErrorCode = null;
    this.lastErrorMessage = null;
    this.state = 'idle';
    this.emit({ type: 'visual.intelligence.updated', timestamp: Date.now() });
  }

  async analyzeFrame(input: AnalyzeFrameInput): Promise<AnalyzeFrameResult> {
    const config = this.getConfig();
    const started = Date.now();
    const requestId = this.createId();
    const frame = input.frame;

    if (!config.enabled && !input.force) {
      return {
        requestId,
        frameId: frame.id,
        relevance: 'UNKNOWN',
        skipped: true,
        skipReason: 'disabled',
        ocr: null,
        vision: null,
        processingTimeMs: 0,
      };
    }

    if (this.activeByFrame.has(frame.id)) {
      return {
        requestId,
        frameId: frame.id,
        relevance: 'UNKNOWN',
        skipped: true,
        skipReason: 'already_processing',
        ocr: null,
        vision: null,
        processingTimeMs: 0,
      };
    }

    if (this.analysedHashes.has(frame.contentHash) && !input.force) {
      return {
        requestId,
        frameId: frame.id,
        relevance: 'UNKNOWN',
        skipped: true,
        skipReason: 'duplicate_frame',
        ocr: null,
        vision: null,
        processingTimeMs: 0,
      };
    }

    const relevance = this.relevance.evaluate(input.question ?? null);
    if (relevance === 'NOT_RELEVANT' && !input.force) {
      return {
        requestId,
        frameId: frame.id,
        relevance,
        skipped: true,
        skipReason: 'not_relevant',
        ocr: null,
        vision: null,
        processingTimeMs: 0,
      };
    }

    if (this.analysedHashes.size >= config.maxAnalysisFrames) {
      const oldest = this.analysedHashes.keys().next().value;
      if (oldest) this.analysedHashes.delete(oldest);
    }

    this.activeByFrame.add(frame.id);
    this.activeRequestId = requestId;
    this.cancelRequested = false;
    this.lastErrorCode = null;
    this.lastErrorMessage = null;

    let ocr: OCRResult | null = null;
    let vision: VisionAnalysis | null = null;
    let phase: 'idle' | 'ocr' | 'vision' = 'idle';

    try {
      await this.refreshCapabilities();

      const ocrCaps = await this.ocrProvider.getCapabilities();
      const visionCaps = await this.visionProvider.getCapabilities();
      const runOcr =
        config.ocr.enabled &&
        (ocrCaps.available === 'SUPPORTED' || ocrCaps.available === 'PARTIAL');
      const runVision =
        config.vision.enabled &&
        (visionCaps.available === 'SUPPORTED' || visionCaps.available === 'PARTIAL');

      if (!runOcr && !runVision) {
        const code =
          ocrCaps.available === 'NOT_CONFIGURED' || visionCaps.available === 'NOT_CONFIGURED'
            ? 'OCR_NOT_CONFIGURED'
            : 'OCR_PROVIDER_UNAVAILABLE';
        throw new AppError('CONFIGURATION', 'Visual intelligence providers unavailable', {
          details: { code },
        });
      }

      if (runOcr) {
        phase = 'ocr';
        this.state = 'ocr_running';
        this.emit({
          type: 'visual.ocr.started',
          timestamp: Date.now(),
          frameId: frame.id,
          requestId,
        });
        this.onLog('visual.ocr.started', { frameId: frame.id, requestId, provider: ocrCaps.providerName });

        ocr = await withTimeout(
          this.ocrProvider.recognize(frame, requestId),
          config.analysisTimeoutMs,
          'OCR_TIMEOUT',
        );

        if (this.cancelRequested || ocr.status === 'cancelled') {
          throw new AppError('PROVIDER', 'Visual analysis cancelled', {
            details: { code: 'VISUAL_ANALYSIS_CANCELLED' },
          });
        }

        this.lastOcrAt = Date.now();
        this.ocrResultCount += 1;
        this.emit({
          type: 'visual.ocr.completed',
          timestamp: Date.now(),
          frameId: frame.id,
          requestId,
          latencyMs: ocr.processingTimeMs,
        });
        this.onLog('visual.ocr.completed', {
          frameId: frame.id,
          requestId,
          provider: ocrCaps.providerName,
          latency: ocr.processingTimeMs,
          status: ocr.status,
        });
      }

      if (runVision) {
        phase = 'vision';
        this.state = 'vision_running';
        this.emit({
          type: 'visual.vision.started',
          timestamp: Date.now(),
          frameId: frame.id,
          requestId,
        });
        this.onLog('visual.vision.started', {
          frameId: frame.id,
          requestId,
          provider: visionCaps.providerName,
        });

        const imageBase64 = Buffer.from(frame.bytes).toString('base64');
        vision = await withTimeout(
          this.visionProvider.analyze({
            requestId,
            frameId: frame.id,
            mimeType: frame.mimeType,
            imageBase64,
            width: frame.width,
            height: frame.height,
            ocrText: ocr?.text || null,
            questionText: input.question?.text ?? null,
            questionType: input.question?.type ?? null,
            relevantTranscript: input.relevantTranscript?.slice(0, 800) ?? null,
            mode: input.question ? 'question_aware' : 'technical',
          }),
          config.analysisTimeoutMs,
          'VISION_TIMEOUT',
        );

        if (this.cancelRequested || vision.status === 'cancelled') {
          throw new AppError('PROVIDER', 'Visual analysis cancelled', {
            details: { code: 'VISUAL_ANALYSIS_CANCELLED' },
          });
        }

        // Deduplicate OCR text already present in vision relevantText.
        if (ocr?.text && vision.relevantText && vision.relevantText.includes(ocr.text.slice(0, 80))) {
          ocr = { ...ocr, text: '' };
        }

        this.lastVisionAt = Date.now();
        this.visionAnalysisCount += 1;
        this.emit({
          type: 'visual.vision.completed',
          timestamp: Date.now(),
          frameId: frame.id,
          requestId,
          latencyMs: vision.processingTimeMs,
          contentType: vision.contentType,
        });
        this.onLog('visual.vision.completed', {
          frameId: frame.id,
          requestId,
          provider: visionCaps.providerName,
          latency: vision.processingTimeMs,
          status: vision.status,
          contentType: vision.contentType,
        });
      }

      this.analysedHashes.set(frame.contentHash, Date.now());
      this.state = 'completed';
      this.lastProcessingTimeMs = Date.now() - started;
      this.onResults?.({ frameId: frame.id, ocr, vision });
      this.emit({
        type: 'visual.intelligence.updated',
        timestamp: Date.now(),
        frameId: frame.id,
        requestId,
        latencyMs: this.lastProcessingTimeMs,
      });

      return {
        requestId,
        frameId: frame.id,
        relevance,
        skipped: false,
        ocr,
        vision,
        processingTimeMs: this.lastProcessingTimeMs,
      };
    } catch (error) {
      const safe = toSafeErrorPayload(error);
      const code = String(safe.details?.code ?? safe.code);
      this.lastErrorCode = code;
      this.lastErrorMessage = safe.message;
      this.state = code === 'VISUAL_ANALYSIS_CANCELLED' ? 'cancelled' : 'failed';

      if (phase === 'ocr' || code.startsWith('OCR_')) {
        this.emit({
          type: 'visual.ocr.failed',
          timestamp: Date.now(),
          frameId: frame.id,
          requestId,
          code,
          message: safe.message,
        });
      } else if (phase === 'vision' || code.startsWith('VISION_')) {
        this.emit({
          type: 'visual.vision.failed',
          timestamp: Date.now(),
          frameId: frame.id,
          requestId,
          code,
          message: safe.message,
        });
      }

      this.emit({
        type: 'visual.intelligence.updated',
        timestamp: Date.now(),
        frameId: frame.id,
        requestId,
        code,
        message: safe.message,
      });
      this.onLog('visual.intelligence.failed', {
        frameId: frame.id,
        requestId,
        errorCode: code,
      });
      throw error;
    } finally {
      this.activeByFrame.delete(frame.id);
      if (this.activeRequestId === requestId) {
        this.activeRequestId = null;
      }
      this.cancelRequested = false;
    }
  }

  private emit(event: VisualIntelligenceEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError('PROVIDER', `Timed out after ${ms}ms`, { details: { code } }));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
