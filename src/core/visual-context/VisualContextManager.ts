import type {
  VisualCaptureCapabilities,
  VisualCaptureRequest,
  VisualCaptureSource,
  VisualContextSnapshot,
  VisualContextStatus,
  VisualEvent,
  VisualFrame,
  VisualFrameReference,
  VisualOCRSummary,
  VisualPublicConfig,
  VisualRuntimeState,
  VisualSourceKind,
  VisualVisionSummary,
} from '../../shared/visual-context/types';
import { DEFAULT_VISUAL_PUBLIC_CONFIG } from '../../shared/visual-context/types';
import type { OCRResult } from '../../shared/ocr/types';
import type { VisionAnalysis } from '../../shared/vision/types';
import { AppError, toSafeErrorPayload } from '../../shared/errors';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';
import type { VisualCaptureProvider } from './VisualCaptureProvider';
import { VisualFrameDeduplicator } from './VisualFrameDeduplicator';
import { hashVisualBytes, toFrameReference, VisualFrameValidator } from './VisualFrameValidator';

export type VisualListener = (event: VisualEvent) => void;

export interface VisualContextManagerOptions {
  provider: VisualCaptureProvider;
  idGenerator?: IdGenerator;
  getConfig?: () => VisualPublicConfig;
  onLog?: (event: string, meta: Record<string, unknown>) => void;
}

export class VisualContextManager {
  private readonly provider: VisualCaptureProvider;
  private readonly createId: IdGenerator;
  private readonly getConfig: () => VisualPublicConfig;
  private readonly onLog: (event: string, meta: Record<string, unknown>) => void;
  private readonly validator = new VisualFrameValidator();
  private readonly deduplicator = new VisualFrameDeduplicator();
  private readonly listeners = new Set<VisualListener>();
  private readonly frames: VisualFrame[] = [];
  private readonly ocrResults: VisualOCRSummary[] = [];
  private readonly visionAnalyses: VisualVisionSummary[] = [];
  private state: VisualRuntimeState = 'disabled';
  private selectedSourceId: string | null = null;
  private selectedSourceKind: VisualSourceKind = 'NONE';
  private discardedCount = 0;
  private latestCaptureAt: number | null = null;
  private lastErrorCode: string | null = null;
  private lastErrorMessage: string | null = null;
  private capabilities: VisualCaptureCapabilities | null = null;
  private sessionActive = false;

  constructor(options: VisualContextManagerOptions) {
    this.provider = options.provider;
    this.createId = options.idGenerator ?? createDefaultIdGenerator();
    this.getConfig = options.getConfig ?? (() => structuredClone(DEFAULT_VISUAL_PUBLIC_CONFIG));
    this.onLog = options.onLog ?? (() => undefined);
  }

  subscribe(listener: VisualListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initializeForSession(): Promise<void> {
    this.sessionActive = true;
    this.capabilities = await this.provider.getCapabilities();
    const config = this.getConfig();
    if (config.enabled) {
      this.state = 'ready';
      this.selectedSourceKind = config.source;
    } else {
      this.state = 'disabled';
    }
    this.emitStatus();
  }

  async shutdownForSession(): Promise<void> {
    this.sessionActive = false;
    await this.provider.stop();
    this.clearFrames();
    this.state = 'disabled';
    this.selectedSourceId = null;
    this.lastErrorCode = null;
    this.lastErrorMessage = null;
    this.emitStatus();
  }

  async dispose(): Promise<void> {
    await this.shutdownForSession();
    await this.provider.dispose();
  }

  async getCapabilities(): Promise<VisualCaptureCapabilities> {
    this.capabilities = await this.provider.getCapabilities();
    this.emit({
      type: 'visual.capability.changed',
      timestamp: Date.now(),
      state: this.state,
    });
    return structuredClone(this.capabilities);
  }

  async listSources(): Promise<VisualCaptureSource[]> {
    return this.provider.listSources();
  }

  async requestPermission(): Promise<boolean> {
    const granted = await this.provider.requestPermission();
    this.capabilities = await this.provider.getCapabilities();
    this.emitStatus();
    return granted;
  }

  enable(): VisualContextStatus {
    const config = this.getConfig();
    if (!config.enabled && !this.sessionActive) {
      // Allow enable in diagnostics even outside session, but capture requires session-ready state.
    }
    this.state = 'ready';
    this.selectedSourceKind = config.source === 'NONE' ? 'DISPLAY' : config.source;
    this.lastErrorCode = null;
    this.lastErrorMessage = null;
    this.emitStatus();
    return this.getStatus();
  }

  disable(): VisualContextStatus {
    void this.provider.stop();
    this.state = 'disabled';
    this.emitStatus();
    return this.getStatus();
  }

  setSource(kind: VisualSourceKind, sourceId: string | null = null): VisualContextStatus {
    if (kind === 'NONE') {
      this.selectedSourceKind = 'NONE';
      this.selectedSourceId = null;
      this.emitStatus();
      return this.getStatus();
    }
    this.selectedSourceKind = kind;
    this.selectedSourceId = sourceId;
    if (this.state === 'disabled') {
      this.state = 'ready';
    }
    this.emitStatus();
    return this.getStatus();
  }

  start(): VisualContextStatus {
    if (this.state === 'disabled') {
      throw new AppError('SESSION', 'Visual context is disabled', { details: { code: 'capture_not_active' } });
    }
    if (this.selectedSourceKind === 'NONE') {
      throw new AppError('VALIDATION', 'Select a visual source before starting', {
        details: { code: 'invalid_source' },
      });
    }
    if (this.state === 'capturing') {
      throw new AppError('SESSION', 'Visual capture already active', {
        details: { code: 'capture_already_active' },
      });
    }
    this.state = 'capturing';
    this.emitStatus();
    return this.getStatus();
  }

  stop(): VisualContextStatus {
    void this.provider.stop();
    if (this.state === 'disabled') {
      return this.getStatus();
    }
    this.state = 'ready';
    this.emitStatus();
    return this.getStatus();
  }

  pause(): VisualContextStatus {
    if (this.state !== 'capturing') {
      throw new AppError('SESSION', 'Visual capture is not active', {
        details: { code: 'capture_not_active' },
      });
    }
    this.state = 'paused';
    this.emitStatus();
    return this.getStatus();
  }

  resume(): VisualContextStatus {
    if (this.state !== 'paused') {
      throw new AppError('SESSION', 'Visual capture is not paused', {
        details: { code: 'capture_not_active' },
      });
    }
    this.state = 'capturing';
    this.emitStatus();
    return this.getStatus();
  }

  async captureNow(request?: Partial<VisualCaptureRequest>): Promise<VisualFrameReference> {
    if (this.state === 'disabled') {
      throw new AppError('SESSION', 'Visual context is disabled', {
        details: { code: 'capture_not_active' },
      });
    }
    if (this.state === 'paused') {
      throw new AppError('SESSION', 'Visual capture is paused', {
        details: { code: 'capture_not_active' },
      });
    }

    const config = this.getConfig();
    const sourceKind = request?.sourceKind ?? this.selectedSourceKind;
    if (sourceKind === 'NONE') {
      throw new AppError('VALIDATION', 'No visual source selected', {
        details: { code: 'invalid_source' },
      });
    }

    const started = Date.now();
    try {
      const captured = await this.provider.capture({
        sourceKind,
        sourceId: request?.sourceId ?? this.selectedSourceId ?? undefined,
        region: request?.region,
        manual: request?.manual,
      });

      const frame: VisualFrame = {
        ...captured,
        id: captured.id || this.createId(),
        contentHash: captured.contentHash || hashVisualBytes(captured.bytes),
        captureDurationMs: captured.captureDurationMs || Date.now() - started,
        status: 'accepted',
      };

      this.validator.validate({
        bytes: frame.bytes,
        width: frame.width,
        height: frame.height,
        mimeType: frame.mimeType,
        source: frame.source,
        config,
      });

      if (this.deduplicator.isDuplicate(frame, this.frames)) {
        this.discardedCount += 1;
        this.emit({
          type: 'visual.frame.rejected',
          timestamp: Date.now(),
          frameId: frame.id,
          source: frame.source,
          code: 'duplicate',
          message: 'Duplicate visual frame discarded',
          byteSize: frame.byteSize,
        });
        this.onLog('visual.frame.rejected', {
          frameId: frame.id,
          code: 'duplicate',
          byteSize: frame.byteSize,
        });
        throw new AppError('VALIDATION', 'Duplicate visual frame discarded', {
          details: { code: 'duplicate' },
        });
      }

      this.addFrame(frame, config);
      this.latestCaptureAt = frame.timestamp;
      this.lastErrorCode = null;
      this.lastErrorMessage = null;
      if (this.state === 'ready') {
        this.state = 'capturing';
      }

      this.onLog('visual.frame.captured', {
        frameId: frame.id,
        source: frame.source,
        width: frame.width,
        height: frame.height,
        byteSize: frame.byteSize,
        latencyMs: frame.captureDurationMs,
      });
      this.emit({
        type: 'visual.frame.captured',
        timestamp: Date.now(),
        frameId: frame.id,
        source: frame.source,
        width: frame.width,
        height: frame.height,
        byteSize: frame.byteSize,
      });
      this.emit({
        type: 'visual.context.changed',
        timestamp: Date.now(),
        frameId: frame.id,
        source: frame.source,
        state: this.state,
      });
      this.emitStatus();
      return toFrameReference(frame);
    } catch (error) {
      const safe = toSafeErrorPayload(error);
      this.lastErrorCode = String(safe.details?.code ?? safe.code);
      this.lastErrorMessage = safe.message;
      this.state = 'error';
      this.emit({
        type: 'visual.frame.rejected',
        timestamp: Date.now(),
        source: sourceKind,
        code: this.lastErrorCode,
        message: safe.message,
      });
      this.emitStatus();
      throw error;
    }
  }

  clear(): VisualContextStatus {
    this.clearFrames();
    this.emit({
      type: 'visual.context.changed',
      timestamp: Date.now(),
      state: this.state,
      message: 'Visual context cleared',
    });
    this.emitStatus();
    return this.getStatus();
  }

  getSnapshot(): VisualContextSnapshot {
    const refs = this.frames.map((frame) => toFrameReference(frame));
    const payloadBytes = this.frames.reduce((sum, frame) => sum + frame.byteSize, 0);
    return {
      frames: refs,
      latestFrame: refs.length > 0 ? refs[refs.length - 1]! : null,
      capturedAt: this.latestCaptureAt,
      source: this.selectedSourceKind,
      ocrResults: structuredClone(this.ocrResults),
      visionAnalyses: structuredClone(this.visionAnalyses),
      metadata: {
        frameCount: refs.length,
        discardedCount: this.discardedCount,
        truncated: this.discardedCount > 0,
        approximatePayloadBytes: payloadBytes,
        source: this.selectedSourceKind,
        visualFrameCount: refs.length,
        ocrResultCount: this.ocrResults.length,
        visionAnalysisCount: this.visionAnalyses.length,
        discardedFrameCount: this.discardedCount,
        payloadBytes,
      },
    };
  }

  /** Transient bytes for vision/OCR — not exposed over IPC by default. */
  getFrameBytes(frameId: string): Uint8Array | null {
    const frame = this.frames.find((item) => item.id === frameId);
    return frame ? new Uint8Array(frame.bytes) : null;
  }

  getFrame(frameId: string): VisualFrame | null {
    const frame = this.frames.find((item) => item.id === frameId);
    return frame ?? null;
  }

  getLatestFrame(): VisualFrame | null {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1]! : null;
  }

  recordIntelligence(input: {
    frameId: string;
    ocr: OCRResult | null;
    vision: VisionAnalysis | null;
  }): void {
    if (input.ocr && input.ocr.text) {
      this.ocrResults.push({
        id: input.ocr.id,
        sourceFrameId: input.ocr.sourceFrameId,
        text: input.ocr.text,
        confidence: input.ocr.confidence,
        language: input.ocr.language,
        status: input.ocr.status,
        createdAt: input.ocr.createdAt,
        processingTimeMs: input.ocr.processingTimeMs,
      });
      while (this.ocrResults.length > 6) {
        this.ocrResults.shift();
      }
    }
    if (input.vision) {
      this.visionAnalyses.push({
        id: input.vision.id,
        sourceFrameId: input.vision.sourceFrameId,
        description: input.vision.description,
        contentType: input.vision.contentType,
        confidence: input.vision.confidence,
        relevantText: input.vision.relevantText,
        technicalElements: input.vision.technicalElements,
        detectedEntities: input.vision.detectedEntities,
        warnings: input.vision.warnings,
        status: input.vision.status,
        createdAt: input.vision.createdAt,
        processingTimeMs: input.vision.processingTimeMs,
      });
      while (this.visionAnalyses.length > 6) {
        this.visionAnalyses.shift();
      }
    }
    this.emit({
      type: 'visual.context.changed',
      timestamp: Date.now(),
      frameId: input.frameId,
      state: this.state,
    });
  }

  clearIntelligenceResults(): void {
    this.ocrResults.length = 0;
    this.visionAnalyses.length = 0;
    this.emit({
      type: 'visual.context.changed',
      timestamp: Date.now(),
      state: this.state,
      message: 'Visual intelligence results cleared',
    });
  }

  getStatus(): VisualContextStatus {
    const config = this.getConfig();
    return {
      state: this.state,
      enabled: this.state !== 'disabled' || config.enabled,
      source: this.selectedSourceKind,
      selectedSourceId: this.selectedSourceId,
      frameCount: this.frames.length,
      latestCaptureAt: this.latestCaptureAt,
      lastErrorCode: this.lastErrorCode,
      lastErrorMessage: this.lastErrorMessage,
      permissionGranted: this.capabilities?.permissionGranted ?? null,
      capabilities:
        this.capabilities ??
        ({
          platform: 'unknown',
          displayCapture: 'UNKNOWN',
          windowCapture: 'UNKNOWN',
          regionCapture: 'UNKNOWN',
          manualImage: 'SUPPORTED',
          permissionRequired: false,
          permissionGranted: null,
          maxRecommendedWidth: config.maxWidth,
          maxRecommendedHeight: config.maxHeight,
          maxFrameBytes: config.maxImageBytes,
          notes: ['Capabilities not probed yet'],
        } satisfies VisualCaptureCapabilities),
    };
  }

  private addFrame(frame: VisualFrame, config: VisualPublicConfig): void {
    this.frames.push(frame);
    while (this.frames.length > config.maxFrames) {
      const removed = this.frames.shift();
      if (removed) {
        removed.status = 'evicted';
        this.discardedCount += 1;
      }
    }
    let total = this.frames.reduce((sum, item) => sum + item.byteSize, 0);
    while (total > config.maxVisualContextBytes && this.frames.length > 1) {
      const removed = this.frames.shift();
      if (removed) {
        total -= removed.byteSize;
        this.discardedCount += 1;
      }
    }
  }

  private clearFrames(): void {
    this.frames.length = 0;
    this.ocrResults.length = 0;
    this.visionAnalyses.length = 0;
    this.discardedCount = 0;
    this.latestCaptureAt = null;
  }

  private emitStatus(): void {
    this.emit({
      type: 'visual.status.changed',
      timestamp: Date.now(),
      state: this.state,
      source: this.selectedSourceKind,
    });
  }

  private emit(event: VisualEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
