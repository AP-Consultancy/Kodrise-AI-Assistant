import { BrowserWindow } from 'electron';
import {
  VisualContextManager,
  type VisualListener,
} from '../../core/visual-context/VisualContextManager';
import {
  VisualIntelligencePipeline,
  type VisualIntelligenceListener,
} from '../../core/visual-intelligence/VisualIntelligencePipeline';
import { createOCRProvider, createVisionProvider } from '../../core/visual-intelligence/createVisualProviders';
import { RuleBasedVisualRelevanceEvaluator } from '../../core/visual-intelligence/VisualRelevanceEvaluator';
import type {
  VisualCaptureRequest,
  VisualCaptureSource,
  VisualContextSnapshot,
  VisualContextStatus,
  VisualEvent,
  VisualFrameReference,
  VisualPublicConfig,
  VisualSourceKind,
} from '../../shared/visual-context/types';
import { DEFAULT_VISUAL_PUBLIC_CONFIG } from '../../shared/visual-context/types';
import type {
  VisualIntelligencePublicConfig,
  VisualIntelligenceStatus,
  VisualIntelligenceEvent,
} from '../../shared/visual-intelligence/types';
import { DEFAULT_VISUAL_INTELLIGENCE_CONFIG } from '../../shared/visual-intelligence/types';
import type { DetectedQuestion } from '../../shared/questions/types';
import { IpcEvents } from '../../shared/ipc/channels';
import { logger } from '../services/logging';
import { ElectronVisualCaptureProvider } from './ElectronVisualCaptureProvider';
import { OpenAIOCRProvider } from '../ocr/OpenAIOCRProvider';
import { OpenAIVisionProvider } from '../vision/OpenAIVisionProvider';

export interface VisualContextHostOptions {
  getConfig?: () => VisualPublicConfig;
  getIntelligenceConfig?: () => VisualIntelligencePublicConfig;
  getOpenAiApiKey?: () => Promise<string | null>;
  getCurrentQuestion?: () => DetectedQuestion | null;
  getRelevantTranscript?: () => string | null;
}

export class VisualContextHost {
  private readonly provider: ElectronVisualCaptureProvider;
  private readonly manager: VisualContextManager;
  private readonly pipeline: VisualIntelligencePipeline;
  private readonly getIntelligenceConfig: () => VisualIntelligencePublicConfig;
  private readonly getCurrentQuestion: () => DetectedQuestion | null;
  private readonly getRelevantTranscript: () => string | null;
  private unsubscribers: Array<() => void> = [];

  constructor(options: VisualContextHostOptions = {}) {
    const getConfig = options.getConfig ?? (() => structuredClone(DEFAULT_VISUAL_PUBLIC_CONFIG));
    this.getIntelligenceConfig =
      options.getIntelligenceConfig ?? (() => structuredClone(DEFAULT_VISUAL_INTELLIGENCE_CONFIG));
    this.getCurrentQuestion = options.getCurrentQuestion ?? (() => null);
    this.getRelevantTranscript = options.getRelevantTranscript ?? (() => null);
    const getApiKey = options.getOpenAiApiKey ?? (async () => null);

    this.provider = new ElectronVisualCaptureProvider({ getConfig });
    this.manager = new VisualContextManager({
      provider: this.provider,
      getConfig,
      onLog: (event, meta) => logger.info(event, meta),
    });

    const intelligenceConfig = this.getIntelligenceConfig();
    const ocrProvider = createOCRProvider({
      config: intelligenceConfig,
      createOpenAiOcr: () =>
        new OpenAIOCRProvider({
          getApiKey,
          model: this.getIntelligenceConfig().vision.model,
          maxCharacters: this.getIntelligenceConfig().ocr.maxCharacters,
          timeoutMs: this.getIntelligenceConfig().analysisTimeoutMs,
        }),
    });
    const visionProvider = createVisionProvider({
      config: intelligenceConfig,
      createOpenAiVision: () =>
        new OpenAIVisionProvider({
          getApiKey,
          model: this.getIntelligenceConfig().vision.model,
          timeoutMs: this.getIntelligenceConfig().analysisTimeoutMs,
        }),
    });

    this.pipeline = new VisualIntelligencePipeline({
      ocrProvider,
      visionProvider,
      getConfig: this.getIntelligenceConfig,
      relevanceEvaluator: new RuleBasedVisualRelevanceEvaluator(),
      onLog: (event, meta) => logger.info(event, meta),
      onResults: (input) => this.manager.recordIntelligence(input),
    });

    this.unsubscribers.push(this.manager.subscribe((event) => this.broadcastVisual(event)));
    this.unsubscribers.push(
      this.pipeline.subscribe((event) => this.broadcastIntelligence(event)),
    );
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    void this.manager.dispose();
  }

  async onSessionStart(): Promise<void> {
    await this.manager.initializeForSession();
    await this.pipeline.refreshCapabilities();
  }

  async onSessionStop(): Promise<void> {
    await this.pipeline.cancel();
    this.pipeline.clearResults();
    this.manager.clearIntelligenceResults();
    await this.manager.shutdownForSession();
  }

  async onSessionPause(): Promise<VisualContextStatus> {
    const status = this.manager.getStatus();
    if (status.state === 'capturing') {
      return this.manager.pause();
    }
    return status;
  }

  async onSessionResume(): Promise<VisualContextStatus> {
    const status = this.manager.getStatus();
    if (status.state === 'paused') {
      return this.manager.resume();
    }
    return status;
  }

  getCapabilities() {
    return this.manager.getCapabilities();
  }

  listSources(): Promise<VisualCaptureSource[]> {
    return this.manager.listSources();
  }

  requestPermission(): Promise<boolean> {
    return this.manager.requestPermission();
  }

  getStatus(): VisualContextStatus {
    return this.manager.getStatus();
  }

  getSnapshot(): VisualContextSnapshot {
    return this.manager.getSnapshot();
  }

  getIntelligenceStatus(): VisualIntelligenceStatus {
    return this.pipeline.getStatus();
  }

  async getIntelligenceCapabilities() {
    await this.pipeline.refreshCapabilities();
    const status = this.pipeline.getStatus();
    return {
      ocr: {
        available: status.ocrAvailable,
        providerName: status.ocrProvider,
      },
      vision: {
        available: status.visionAvailable,
        providerName: status.visionProvider,
        model: status.model,
      },
      enabled: status.enabled,
    };
  }

  enable(): VisualContextStatus {
    return this.manager.enable();
  }

  disable(): VisualContextStatus {
    return this.manager.disable();
  }

  setSource(kind: VisualSourceKind, sourceId?: string | null): VisualContextStatus {
    return this.manager.setSource(kind, sourceId ?? null);
  }

  start(): VisualContextStatus {
    return this.manager.start();
  }

  stop(): VisualContextStatus {
    return this.manager.stop();
  }

  pause(): VisualContextStatus {
    return this.manager.pause();
  }

  resume(): VisualContextStatus {
    return this.manager.resume();
  }

  async captureNow(request?: Partial<VisualCaptureRequest>): Promise<VisualFrameReference> {
    if (request?.sourceKind === 'MANUAL_IMAGE' && !request.manual) {
      const manual = await this.provider.pickManualImage();
      const frame = await this.manager.captureNow({
        ...request,
        sourceKind: 'MANUAL_IMAGE',
        manual,
      });
      void this.maybeAnalyzeAfterCapture(frame.id);
      return frame;
    }
    const frame = await this.manager.captureNow(request);
    void this.maybeAnalyzeAfterCapture(frame.id);
    return frame;
  }

  clear(): VisualContextStatus {
    this.pipeline.clearResults();
    return this.manager.clear();
  }

  async analyzeCurrent(force = true): Promise<{
    skipped: boolean;
    skipReason?: string;
    frameId: string | null;
  }> {
    const frame = this.manager.getLatestFrame();
    if (!frame) {
      return { skipped: true, skipReason: 'no_frame', frameId: null };
    }
    const result = await this.pipeline.analyzeFrame({
      frame,
      question: this.getCurrentQuestion(),
      relevantTranscript: this.getRelevantTranscript(),
      force,
    });
    return {
      skipped: result.skipped,
      skipReason: result.skipReason,
      frameId: result.frameId,
    };
  }

  async analyzeForQuestion(question: DetectedQuestion): Promise<void> {
    const config = this.getIntelligenceConfig();
    if (!config.enabled || !config.autoAnalyzeOnQuestion) {
      return;
    }
    const frame = this.manager.getLatestFrame();
    if (!frame) {
      return;
    }
    try {
      await this.pipeline.analyzeFrame({
        frame,
        question,
        relevantTranscript: this.getRelevantTranscript(),
        force: false,
      });
    } catch (error) {
      logger.warn('visual.intelligence.question_analyze.failed', {
        questionId: question.id,
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  async cancelIntelligence(requestId?: string): Promise<VisualIntelligenceStatus> {
    await this.pipeline.cancel(requestId);
    return this.pipeline.getStatus();
  }

  clearIntelligenceResults(): VisualIntelligenceStatus {
    this.manager.clearIntelligenceResults();
    this.pipeline.clearResults();
    return this.pipeline.getStatus();
  }

  subscribe(listener: VisualListener): () => void {
    return this.manager.subscribe(listener);
  }

  subscribeIntelligence(listener: VisualIntelligenceListener): () => void {
    return this.pipeline.subscribe(listener);
  }

  private async maybeAnalyzeAfterCapture(frameId: string): Promise<void> {
    const config = this.getIntelligenceConfig();
    if (!config.enabled || !config.autoAnalyzeOnCapture) {
      return;
    }
    const frame = this.manager.getFrame(frameId);
    if (!frame) return;
    try {
      await this.pipeline.analyzeFrame({
        frame,
        question: this.getCurrentQuestion(),
        relevantTranscript: this.getRelevantTranscript(),
        force: false,
      });
    } catch (error) {
      logger.warn('visual.intelligence.capture_analyze.failed', {
        frameId,
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  private broadcastVisual(event: VisualEvent): void {
    const channel =
      event.type === 'visual.status.changed'
        ? IpcEvents.VISUAL_STATUS_CHANGED
        : event.type === 'visual.frame.captured'
          ? IpcEvents.VISUAL_FRAME_CAPTURED
          : event.type === 'visual.frame.rejected'
            ? IpcEvents.VISUAL_FRAME_REJECTED
            : event.type === 'visual.context.changed'
              ? IpcEvents.VISUAL_CONTEXT_CHANGED
              : IpcEvents.VISUAL_CAPABILITY_CHANGED;

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, event);
      }
    }
  }

  private broadcastIntelligence(event: VisualIntelligenceEvent): void {
    const channel =
      event.type === 'visual.ocr.started'
        ? IpcEvents.VISUAL_OCR_STARTED
        : event.type === 'visual.ocr.completed'
          ? IpcEvents.VISUAL_OCR_COMPLETED
          : event.type === 'visual.ocr.failed'
            ? IpcEvents.VISUAL_OCR_FAILED
            : event.type === 'visual.vision.started'
              ? IpcEvents.VISUAL_VISION_STARTED
              : event.type === 'visual.vision.completed'
                ? IpcEvents.VISUAL_VISION_COMPLETED
                : event.type === 'visual.vision.failed'
                  ? IpcEvents.VISUAL_VISION_FAILED
                  : IpcEvents.VISUAL_INTELLIGENCE_UPDATED;

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, event);
      }
    }
  }
}
