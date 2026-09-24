import { BrowserWindow } from 'electron';
import { AudioCaptureController } from '../../../core/audio/AudioCaptureController';
import { TranscriptStore } from '../../../core/transcription/TranscriptStore';
import { QuestionManager } from '../../../core/questions/QuestionManager';
import { ContextEngine } from '../../../core/context/ContextEngine';
import { AIOrchestrator } from '../../../core/ai/AIOrchestrator';
import type { AIProvider } from '../../../core/ai/AIProvider';
import { MockSTTProvider } from '../../../core/stt/MockSTTProvider';
import type { STTProvider } from '../../../core/stt/STTProvider';
import type {
  AudioCaptureStatus,
  AudioChunkDto,
  AudioDeviceInfo,
  AudioStreamConfig,
  MicrophonePermissionStatus,
} from '../../../shared/audio/types';
import type { TranscriptSnapshot, TranscriptStatus, TranscriptSource } from '../../../shared/transcription/types';
import type { SttConfigStatus, STTProviderStatus } from '../../../shared/stt/types';
import type { SttPublicConfig, AudioInputPublicConfig } from '../../../shared/config/types';
import { DEFAULT_STT_PUBLIC_CONFIG, DEFAULT_AUDIO_INPUT_PUBLIC_CONFIG } from '../../../shared/config/types';
import type {
  AudioInputCapability,
  AudioInputDevice,
  AudioInputDiagnostics,
  AudioInputMode,
  AudioInputStatus,
} from '../../../shared/audio-input/types';
import { AudioInputCoordinator } from '../../../core/audio-input/AudioInputCoordinator';
import type { ContextPublicConfig } from '../../../shared/context/types';
import { DEFAULT_CONTEXT_PUBLIC_CONFIG } from '../../../shared/context/types';
import type { AIPublicConfig } from '../../../shared/ai/types';
import { DEFAULT_AI_PUBLIC_CONFIG } from '../../../shared/ai/types';
import type {
  DetectedQuestion,
  QuestionEvent,
  QuestionPipelineStatus,
  QuestionStatusSnapshot,
} from '../../../shared/questions/types';
import type {
  ContextEngineStatus,
  ContextEvent,
  ContextSnapshot,
} from '../../../shared/context/types';
import type {
  AIConfigStatus,
  AIEvent,
  AIOrchestratorStatus,
  AIResponseState,
} from '../../../shared/ai/types';
import { IpcEvents } from '../../../shared/ipc/channels';
import { AudioCaptureError, AudioPermissionError } from '../../../shared/errors';
import { logger } from '../logging';
import { createDefaultIdGenerator } from '../../../shared/session/types';

function base64ToArrayBuffer(dataBase64: string): ArrayBuffer {
  const buffer = Buffer.from(dataBase64, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export interface AudioHostDeps {
  stt?: STTProvider;
  getSttConfig?: () => SttPublicConfig;
  getAudioInputConfig?: () => AudioInputPublicConfig;
  getContextConfig?: () => ContextPublicConfig;
  getAiConfig?: () => AIPublicConfig;
  getVisualContextSnapshot?: () => import('../../../shared/visual-context/types').VisualContextSnapshot | null;
  getInterviewDocuments?: () => import('../../../shared/context/types').InterviewDocumentContext | null;
  hasSttCredential?: () => Promise<boolean>;
  hasAiCredential?: () => Promise<boolean>;
  createSttProvider?: (config: SttPublicConfig) => STTProvider;
  createAiProvider?: (config: AIPublicConfig) => AIProvider;
  sessionId?: () => string | null;
  correlationId?: () => string | null;
  persistAudioInputConfig?: (patch: Partial<AudioInputPublicConfig>) => void;
}

export class AudioHost {
  private readonly capture = new AudioCaptureController();
  private readonly transcripts: TranscriptStore;
  private readonly questions: QuestionManager;
  private readonly contextEngine: ContextEngine;
  private readonly ai: AIOrchestrator;
  private readonly audioInput: AudioInputCoordinator;
  private stt: STTProvider;
  /** Second STT stream for meeting audio when mode is microphone_and_meeting. */
  private meetingStt: STTProvider | null = null;
  private devices: AudioDeviceInfo[] = [];
  private unsubscribers: Array<() => void> = [];
  private readonly getSttConfig: () => SttPublicConfig;
  private readonly getAudioInputConfig: () => AudioInputPublicConfig;
  private readonly persistAudioInputConfig: ((patch: Partial<AudioInputPublicConfig>) => void) | null;
  private readonly hasSttCredential: () => Promise<boolean>;
  private readonly createSttProvider: ((config: SttPublicConfig) => STTProvider) | null;
  private readonly getVisualContextSnapshot: () => import('../../../shared/visual-context/types').VisualContextSnapshot | null;
  private readonly getInterviewDocuments: () => import('../../../shared/context/types').InterviewDocumentContext | null;
  private onQuestionClassified:
    | ((question: DetectedQuestion) => void | Promise<void>)
    | null = null;
  /** When false, Deepgram finals are ignored for question detection (simulation isolation). */
  private microphoneQuestionIngest = true;

  constructor(deps: AudioHostDeps = {}) {
    this.getSttConfig = deps.getSttConfig ?? (() => ({ ...DEFAULT_STT_PUBLIC_CONFIG, provider: 'mock' }));
    this.getAudioInputConfig =
      deps.getAudioInputConfig ?? (() => ({ ...DEFAULT_AUDIO_INPUT_PUBLIC_CONFIG }));
    this.persistAudioInputConfig = deps.persistAudioInputConfig ?? null;
    this.hasSttCredential = deps.hasSttCredential ?? (async () => true);
    this.createSttProvider = deps.createSttProvider ?? null;
    this.getVisualContextSnapshot = deps.getVisualContextSnapshot ?? (() => null);
    this.getInterviewDocuments = deps.getInterviewDocuments ?? (() => null);
    const initialAudio = this.getAudioInputConfig();
    this.audioInput = new AudioInputCoordinator({
      initialMode: initialAudio.inputMode,
      onLog: (event, meta) => logger.info(event, meta),
    });
    this.audioInput.setMicrophoneDeviceId(initialAudio.microphoneDeviceId);
    this.audioInput.setMeetingAudioDeviceId(initialAudio.meetingAudioDeviceId);
    this.stt = deps.stt ?? new MockSTTProvider();
    this.transcripts = new TranscriptStore({
      maxFinals: 200,
      idGenerator: createDefaultIdGenerator(),
    });
    this.questions = new QuestionManager({
      idGenerator: createDefaultIdGenerator(),
      sessionId: deps.sessionId,
      correlationId: deps.correlationId,
      onLog: (event, meta) => logger.info(event, meta),
    });
    this.contextEngine = new ContextEngine({
      idGenerator: createDefaultIdGenerator(),
      sessionId: deps.sessionId,
      correlationId: deps.correlationId,
      getConfig: deps.getContextConfig ?? (() => structuredClone(DEFAULT_CONTEXT_PUBLIC_CONFIG)),
      onLog: (event, meta) => logger.info(event, meta),
    });
    this.ai = new AIOrchestrator({
      idGenerator: createDefaultIdGenerator(),
      sessionId: deps.sessionId,
      correlationId: deps.correlationId,
      getConfig: deps.getAiConfig ?? (() => structuredClone(DEFAULT_AI_PUBLIC_CONFIG)),
      isConfigured: deps.hasAiCredential ?? (async () => false),
      createProvider: deps.createAiProvider,
      getQuestion: (questionId) =>
        this.questions.getRecent(50).find((item) => item.id === questionId) ??
        (this.questions.getCurrent()?.id === questionId ? this.questions.getCurrent() : null),
      getContextForQuestion: (questionId) => {
        const current = this.contextEngine.getCurrent();
        if (current?.questionId === questionId) {
          return current;
        }
        return this.contextEngine.getRecent(30).find((item) => item.questionId === questionId) ?? null;
      },
      onLog: (event, meta) => logger.info(event, meta),
    });

    this.unsubscribers.push(
      this.capture.subscribe((status) => {
        this.broadcast(IpcEvents.AUDIO_STATUS_CHANGED, status);
      }),
    );
    this.unsubscribers.push(
      this.transcripts.subscribe((event) => {
        if (event.type === 'PARTIAL') {
          this.broadcast(IpcEvents.TRANSCRIPT_PARTIAL, event);
        } else if (event.type === 'FINAL') {
          this.broadcast(IpcEvents.TRANSCRIPT_FINAL, event);
          if (event.segment && this.microphoneQuestionIngest) {
            this.questions.processFinalSegment(event.segment);
          }
        } else if (event.type === 'ERROR') {
          this.broadcast(IpcEvents.TRANSCRIPT_ERROR, event);
        }
      }),
    );
    this.unsubscribers.push(
      this.questions.subscribe((event: QuestionEvent) => {
        if (event.type === 'question.detected') {
          this.broadcast(IpcEvents.QUESTION_DETECTED, event);
        } else if (event.type === 'question.classified') {
          this.broadcast(IpcEvents.QUESTION_CLASSIFIED, event);
          if (event.question) {
            const question = event.question;
            void (async () => {
              try {
                await this.onQuestionClassified?.(question);
              } catch (error) {
                logger.warn('visual.intelligence.pre_context.failed', {
                  questionId: question.id,
                  message: error instanceof Error ? error.message : 'unknown',
                });
              }
              const snapshot = this.contextEngine.buildForQuestion({
                question,
                transcriptSegments: this.transcripts.getRecent(50),
                questionHistory: this.questions.getRecent(30),
                visualContext: this.getVisualContextSnapshot(),
                interviewDocuments: this.getInterviewDocuments(),
              });
              if (snapshot) {
                void this.ai
                  .maybeAutoGenerate({ question, context: snapshot })
                  .catch((error) => {
                    logger.warn('ai.auto_generate.failed', {
                      questionId: question.id,
                      message: error instanceof Error ? error.message : 'unknown',
                    });
                  });
              }
            })();
          }
        } else if (event.type === 'question.updated') {
          this.broadcast(IpcEvents.QUESTION_UPDATED, event);
        } else if (event.type === 'question.ignored') {
          this.broadcast(IpcEvents.QUESTION_IGNORED, event);
        } else if (event.type === 'question.failed') {
          this.broadcast(IpcEvents.QUESTION_FAILED, event);
        }
      }),
    );
    this.unsubscribers.push(
      this.contextEngine.subscribe((event: ContextEvent) => {
        if (event.type === 'context.created') {
          this.broadcast(IpcEvents.CONTEXT_CREATED, event);
        } else if (event.type === 'context.updated') {
          this.broadcast(IpcEvents.CONTEXT_UPDATED, event);
        } else if (event.type === 'context.truncated') {
          this.broadcast(IpcEvents.CONTEXT_TRUNCATED, event);
        } else if (event.type === 'context.failed') {
          this.broadcast(IpcEvents.CONTEXT_FAILED, event);
        }
      }),
    );
    this.unsubscribers.push(
      this.ai.subscribe((event: AIEvent) => {
        if (event.type === 'ai.request.started') {
          this.broadcast(IpcEvents.AI_REQUEST_STARTED, event);
        } else if (event.type === 'ai.response.started') {
          this.broadcast(IpcEvents.AI_RESPONSE_STARTED, event);
        } else if (event.type === 'ai.response.chunk') {
          this.broadcast(IpcEvents.AI_RESPONSE_CHUNK, event);
        } else if (event.type === 'ai.response.completed') {
          this.broadcast(IpcEvents.AI_RESPONSE_COMPLETED, event);
        } else if (event.type === 'ai.response.cancelled') {
          this.broadcast(IpcEvents.AI_RESPONSE_CANCELLED, event);
        } else if (event.type === 'ai.response.error') {
          this.broadcast(IpcEvents.AI_RESPONSE_ERROR, event);
        }
      }),
    );
    this.bindStt(this.stt);
  }

  dispose(): void {
    this.unbindSttListeners();
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    this.ai.resetForSessionStop();
    void this.stt.disconnect();
    void this.meetingStt?.disconnect();
    this.meetingStt = null;
    this.audioInput.reset();
  }

  getDevices(): AudioDeviceInfo[] {
    return this.devices.map((device) => ({ ...device }));
  }

  setDevices(devices: AudioDeviceInfo[]): void {
    this.devices = devices.map((device) => ({ ...device }));
  }

  getAudioStatus(): AudioCaptureStatus {
    return this.capture.getStatus();
  }

  getTranscriptSnapshot(): TranscriptSnapshot {
    return this.transcripts.getSnapshot();
  }

  getTranscriptRecent(limit?: number) {
    return this.transcripts.getRecent(limit);
  }

  getTranscriptStatus(): TranscriptStatus {
    return this.transcripts.getStatus();
  }

  getSttStatus(): STTProviderStatus {
    return this.stt.getStatus();
  }

  async getSttConfigStatus(): Promise<SttConfigStatus> {
    const config = this.getSttConfig();
    const configured = config.provider === 'mock' ? true : await this.hasSttCredential();
    return {
      provider: config.provider,
      model: config.model,
      language: config.language,
      configured,
      sampleRate: config.sampleRate,
      channels: config.channels,
      interimResults: config.interimResults,
    };
  }

  getRecentQuestions(limit?: number): DetectedQuestion[] {
    return this.questions.getRecent(limit);
  }

  getCurrentQuestion(): DetectedQuestion | null {
    return this.questions.getCurrent();
  }

  setOnQuestionClassified(
    handler: ((question: DetectedQuestion) => void | Promise<void>) | null,
  ): void {
    this.onQuestionClassified = handler;
  }

  clearQuestions(): QuestionStatusSnapshot {
    this.questions.clear();
    return this.questions.getStatus();
  }

  processManualQuestion(text: string): DetectedQuestion[] {
    return this.questions.processManualText(text);
  }

  /**
   * Simulation interviewer question — skips STT duplicate detection.
   * Still emits question.classified so Context Engine + AI run normally.
   */
  processSimulatedQuestion(
    text: string,
    options?: {
      simulationQuestionId?: string;
      expectedType?: import('../../../shared/questions/types').QuestionType;
      isFollowUp?: boolean;
      parentQuestionId?: string | null;
    },
  ): DetectedQuestion[] {
    return this.questions.processSimulatedText(text, options);
  }

  /** Gate Deepgram → question detection without disabling Context/AI. */
  setMicrophoneQuestionIngest(enabled: boolean): void {
    this.microphoneQuestionIngest = enabled;
  }

  isMicrophoneQuestionIngestEnabled(): boolean {
    return this.microphoneQuestionIngest;
  }

  getAudioInputStatus(): AudioInputStatus {
    return this.audioInput.getStatus();
  }

  getAudioInputCapability(mode?: AudioInputMode): AudioInputCapability {
    return this.audioInput.getCapability(mode);
  }

  getAudioInputDiagnostics(): AudioInputDiagnostics {
    return this.audioInput.getDiagnostics();
  }

  async enumerateAudioInputDevices(): Promise<AudioInputDevice[]> {
    return this.audioInput.enumerateDevices();
  }

  setAudioInputMode(mode: AudioInputMode): AudioInputStatus {
    this.audioInput.setMode(mode);
    this.persistAudioInputConfig?.({ inputMode: mode });
    return this.audioInput.getStatus();
  }

  setAudioInputDevice(
    role: 'microphone' | 'meeting_audio',
    deviceId: string | null,
  ): AudioInputStatus {
    if (role === 'microphone') {
      this.audioInput.setMicrophoneDeviceId(deviceId);
      this.persistAudioInputConfig?.({ microphoneDeviceId: deviceId });
    } else {
      this.audioInput.setMeetingAudioDeviceId(deviceId);
      this.persistAudioInputConfig?.({ meetingAudioDeviceId: deviceId });
    }
    return this.audioInput.getStatus();
  }

  acknowledgeMeetingAudioConsent(): AudioInputStatus {
    this.audioInput.acknowledgeConsent();
    return this.audioInput.getStatus();
  }

  markAudioInputSourceActive(source: TranscriptSource): AudioInputStatus {
    this.audioInput.markSourceActive(source);
    return this.audioInput.getStatus();
  }

  async start(config?: Partial<AudioStreamConfig>): Promise<AudioCaptureStatus> {
    // Sync mode from persisted config (Settings may have changed).
    const persisted = this.getAudioInputConfig();
    if (persisted.inputMode !== this.audioInput.getMode()) {
      try {
        this.audioInput.setMode(persisted.inputMode);
      } catch {
        // Keep previous mode if unsupported; start will fail below for meeting modes.
      }
    }
    this.audioInput.setMicrophoneDeviceId(persisted.microphoneDeviceId);
    this.audioInput.setMeetingAudioDeviceId(persisted.meetingAudioDeviceId);

    this.audioInput.beginStart();

    const needsMic = this.audioInput.usesMicrophone();
    if (needsMic) {
      const permission = this.capture.getStatus().permission;
      if (permission !== 'granted') {
        throw new AudioPermissionError(
          permission === 'denied'
            ? 'Microphone permission denied'
            : permission === 'unavailable'
              ? 'Microphone unavailable'
              : 'Microphone permission required',
        );
      }
    } else {
      // Meeting-only: allow capture controller to start without mic permission.
      if (this.capture.getStatus().permission !== 'granted') {
        this.capture.setPermission('granted');
      }
    }

    const captureState = this.capture.getStatus().state;
    // Prevent duplicate Deepgram sockets if Start is invoked while already live.
    if (captureState === 'starting' || captureState === 'active') {
      const sttStatus = this.stt.getStatus().status;
      if (sttStatus !== 'connected' && sttStatus !== 'streaming' && sttStatus !== 'connecting') {
        await this.stt.connect();
      }
      if (this.meetingStt) {
        const meetingStatus = this.meetingStt.getStatus().status;
        if (
          meetingStatus !== 'connected' &&
          meetingStatus !== 'streaming' &&
          meetingStatus !== 'connecting'
        ) {
          await this.meetingStt.connect();
        }
      }
      logger.info('audio.start.idempotent', { captureState, sttStatus: this.stt.getStatus().status });
      return this.capture.getStatus();
    }
    if (captureState === 'paused') {
      return this.resume();
    }

    const sttConfig = this.getSttConfig();
    const streamConfig: Partial<AudioStreamConfig> = {
      ...config,
      sampleRate: config?.sampleRate ?? sttConfig.sampleRate,
      channels: config?.channels ?? sttConfig.channels,
      deviceId: config?.deviceId ?? persisted.microphoneDeviceId ?? undefined,
    };

    this.questions.setEnabled(true);
    this.contextEngine.setEnabled(true);
    this.ai.setEnabled(true);
    this.capture.beginStart(streamConfig);
    await this.ensureProviders();
    await this.stt.connect();
    if (this.meetingStt) {
      await this.meetingStt.connect();
    }
    logger.info('stt.connection.connected', {
      provider: this.stt.getStatus().provider,
      meetingStream: Boolean(this.meetingStt),
      audioInputMode: this.audioInput.getMode(),
    });
    logger.info('audio.started', {
      sampleRate: this.capture.getConfig().sampleRate,
      channels: this.capture.getConfig().channels,
      deviceId: this.capture.getStatus().selectedDeviceId,
      audioInputMode: this.audioInput.getMode(),
    });
    return this.capture.getStatus();
  }

  confirmActive(): AudioCaptureStatus {
    this.capture.markActive();
    // Mark expected sources active as soon as capture is confirmed.
    if (this.audioInput.usesMicrophone()) {
      this.audioInput.markSourceActive('microphone');
    }
    if (this.audioInput.usesMeetingAudio()) {
      this.audioInput.markSourceActive('meeting_audio');
    }
    return this.capture.getStatus();
  }

  async pause(): Promise<AudioCaptureStatus> {
    this.capture.pause();
    this.audioInput.pause();
    // Idle Deepgram Listen sockets are closed by the server with 1011; disconnect on pause.
    await this.stt.disconnect();
    if (this.meetingStt) {
      await this.meetingStt.disconnect();
    }
    logger.info('audio.paused', { sttDisconnected: true });
    return this.capture.getStatus();
  }

  async resume(): Promise<AudioCaptureStatus> {
    await this.stt.connect();
    if (this.meetingStt) {
      await this.meetingStt.connect();
    }
    this.capture.resume();
    this.audioInput.resume();
    logger.info('audio.resumed', { sttConnected: true });
    return this.capture.getStatus();
  }

  async stop(): Promise<AudioCaptureStatus> {
    this.capture.beginStop();
    await this.stt.disconnect();
    if (this.meetingStt) {
      await this.meetingStt.disconnect();
      this.meetingStt = null;
    }
    this.audioInput.stop();
    logger.info('stt.disconnected', { provider: this.stt.getStatus().provider });
    this.capture.markStopped();
    logger.info('audio.stopped', {});
    this.broadcast(IpcEvents.AUDIO_FORCE_STOP, { reason: 'stop' });
    return this.capture.getStatus();
  }

  async forceStopFromSession(): Promise<void> {
    this.questions.resetForSessionStop();
    this.contextEngine.resetForSessionStop();
    this.ai.resetForSessionStop();
    this.transcripts.clear();
    this.audioInput.reset();
    const state = this.capture.getStatus().state;
    if (state === 'idle' || state === 'stopped') {
      await this.stt.disconnect();
      if (this.meetingStt) {
        await this.meetingStt.disconnect();
        this.meetingStt = null;
      }
      return;
    }
    logger.info('audio.stopped', { reason: 'session_stop' });
    this.capture.forceStop();
    await this.stt.disconnect();
    if (this.meetingStt) {
      await this.meetingStt.disconnect();
      this.meetingStt = null;
    }
    this.broadcast(IpcEvents.AUDIO_FORCE_STOP, { reason: 'session_stop' });
  }

  async ingestChunk(dto: AudioChunkDto): Promise<void> {
    const status = this.capture.getStatus();
    if (status.state !== 'active') {
      return;
    }
    if (!dto.sampleRate || dto.channels < 1) {
      throw new AudioCaptureError('Invalid audio chunk format');
    }

    const source: TranscriptSource = dto.source ?? 'microphone';
    // Track live sources from actual chunks (no renderer IPC required).
    try {
      this.audioInput.markSourceActive(source);
    } catch {
      // ignore coordinator state errors during ingest
    }

    const chunk = {
      sequence: dto.sequence,
      timestamp: dto.timestamp,
      data: base64ToArrayBuffer(dto.dataBase64),
      sampleRate: dto.sampleRate,
      channels: dto.channels,
    };

    if (source === 'meeting_audio' && this.meetingStt) {
      await this.meetingStt.sendAudio(chunk);
      return;
    }
    // meeting_audio alone (no dual stream) or microphone → primary STT
    await this.stt.sendAudio(chunk);
  }

  markCaptureError(message: string): AudioCaptureStatus {
    logger.warn('audio.error', { message });
    this.audioInput.reportError(message);
    this.capture.markError(message);
    void this.stt.disconnect();
    void this.meetingStt?.disconnect();
    this.broadcast(IpcEvents.AUDIO_FORCE_STOP, { reason: 'error' });
    return this.capture.getStatus();
  }

  private async ensureProviders(): Promise<void> {
    await this.ensureProvider();
    await this.ensureMeetingProvider();
  }

  private async ensureProvider(): Promise<void> {
    if (!this.createSttProvider) {
      this.unbindSttListeners();
      this.bindStt(this.stt, this.primaryTranscriptSource());
      return;
    }
    await this.stt.disconnect();
    this.unbindSttListeners();
    this.stt = this.createSttProvider(this.getSttConfig());
    this.bindStt(this.stt, this.primaryTranscriptSource());
  }

  private async ensureMeetingProvider(): Promise<void> {
    // Dual stream only when both sources are selected.
    if (this.audioInput.getMode() !== 'microphone_and_meeting') {
      if (this.meetingStt) {
        await this.meetingStt.disconnect();
        this.meetingStt = null;
      }
      return;
    }
    if (!this.createSttProvider) {
      // Tests without factory: reuse Mock for second stream.
      this.meetingStt = new MockSTTProvider();
      this.bindStt(this.meetingStt, 'meeting_audio', true);
      return;
    }
    if (this.meetingStt) {
      await this.meetingStt.disconnect();
    }
    this.meetingStt = this.createSttProvider(this.getSttConfig());
    this.bindStt(this.meetingStt, 'meeting_audio', true);
  }

  private primaryTranscriptSource(): TranscriptSource {
    return this.audioInput.getMode() === 'meeting_audio' ? 'meeting_audio' : 'microphone';
  }

  private sttUnsubscribers: Array<() => void> = [];
  private meetingSttUnsubscribers: Array<() => void> = [];

  private unbindSttListeners(): void {
    for (const unsubscribe of this.sttUnsubscribers) {
      unsubscribe();
    }
    this.sttUnsubscribers = [];
    for (const unsubscribe of this.meetingSttUnsubscribers) {
      unsubscribe();
    }
    this.meetingSttUnsubscribers = [];
  }

  private bindStt(
    provider: STTProvider,
    source: TranscriptSource = 'microphone',
    append = false,
  ): void {
    if (!append) {
      this.unbindSttListeners();
    }
    const bucket = append ? this.meetingSttUnsubscribers : this.sttUnsubscribers;
    bucket.push(
      provider.onPartialTranscript((event) => {
        if (event.segment) {
          this.transcripts.applyPartial(
            event.segment.text,
            event.segment.confidence,
            {
              startTime: event.segment.startTime,
              endTime: event.segment.endTime,
            },
            source,
          );
        }
      }),
    );
    bucket.push(
      provider.onFinalTranscript((event) => {
        if (event.segment) {
          this.transcripts.commitFinal(
            event.segment.text,
            event.segment.confidence,
            {
              startTime: event.segment.startTime,
              endTime: event.segment.endTime,
            },
            source,
          );
        }
      }),
    );
    bucket.push(
      provider.onStatus((status) => {
        this.broadcast(IpcEvents.STT_STATUS_CHANGED, status);
      }),
    );
  }

  getQuestionStatus(): QuestionStatusSnapshot {
    return this.questions.getStatus();
  }

  getQuestionPipelineStatus(): QuestionPipelineStatus {
    return this.questions.getPipelineStatus();
  }

  setQuestionProcessingEnabled(enabled: boolean): void {
    this.questions.setEnabled(enabled);
    this.contextEngine.setEnabled(enabled);
    this.ai.setEnabled(enabled);
  }

  getCurrentContext(): ContextSnapshot | null {
    return this.contextEngine.getCurrent();
  }

  getRecentContexts(limit?: number): ContextSnapshot[] {
    return this.contextEngine.getRecent(limit);
  }

  clearContexts(): ContextEngineStatus {
    this.contextEngine.clear();
    return this.contextEngine.getStatus();
  }

  getContextStatus(): ContextEngineStatus {
    return this.contextEngine.getStatus();
  }

  async getAiStatus(): Promise<AIOrchestratorStatus> {
    return this.ai.getStatus();
  }

  async getAiConfigStatus(): Promise<AIConfigStatus> {
    return this.ai.getConfigStatus();
  }

  async generateAiAnswer(questionId: string): Promise<AIResponseState> {
    return this.ai.generateForQuestionId(questionId, { force: true });
  }

  async cancelAi(requestId?: string): Promise<AIResponseState | null> {
    return this.ai.cancel(requestId);
  }

  getCurrentAiResponse(): AIResponseState | null {
    return this.ai.getCurrentResponse();
  }

  subscribeQuestions(listener: (event: QuestionEvent) => void): () => void {
    return this.questions.subscribe(listener);
  }

  subscribeAi(listener: (event: AIEvent) => void): () => void {
    return this.ai.subscribe(listener);
  }

  async clearAiResponses(): Promise<AIOrchestratorStatus> {
    this.ai.clearResponses();
    return this.ai.getStatus();
  }

  clearTranscript(): TranscriptSnapshot {
    this.transcripts.clear();
    return this.transcripts.getSnapshot();
  }

  selectDevice(deviceId: string | null): AudioCaptureStatus {
    if (deviceId && !this.devices.some((device) => device.deviceId === deviceId)) {
      throw new AudioCaptureError('Selected audio device is not available', { deviceId });
    }
    this.capture.selectDevice(deviceId);
    return this.capture.getStatus();
  }

  setPermission(permission: MicrophonePermissionStatus): AudioCaptureStatus {
    if (permission === 'denied') {
      logger.info('audio.permission.denied', {});
    }
    if (permission === 'granted') {
      logger.info('audio.permission.granted', {});
    }
    this.capture.setPermission(permission);
    return this.capture.getStatus();
  }

  beginPermissionRequest(): AudioCaptureStatus {
    logger.info('audio.permission.requested', {});
    this.capture.beginPermissionRequest();
    return this.capture.getStatus();
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(channel, payload);
    }
  }
}
