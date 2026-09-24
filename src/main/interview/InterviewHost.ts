import { BrowserWindow, dialog } from 'electron';
import { InterviewSessionContextStore } from '../../core/interview/InterviewSessionContextStore';
import type {
  InterviewExecutionMode,
  InterviewProductPhase,
  InterviewSessionContextPublic,
  InterviewStatus,
  InterviewSummary,
  InterviewUiState,
  SessionDocumentKind,
  SessionDocumentMeta,
} from '../../shared/interview/types';
import { INTERVIEW_UI_STATE_LABELS } from '../../shared/interview/types';
import type { InterviewDocumentContext } from '../../shared/context/types';
import { IpcEvents } from '../../shared/ipc/channels';
import { AppError } from '../../shared/errors';
import { logger } from '../services/logging';
import type { ConfigurationService } from '../../core/configuration/ConfigurationService';
import type { SessionHost } from '../services/session/SessionHost';
import type { AudioHost } from '../services/audio/AudioHost';
import type { VisualContextHost } from '../visual/VisualContextHost';
import type { QuestionEvent } from '../../shared/questions/types';
import type { AIEvent } from '../../shared/ai/types';
import type { VisualIntelligenceEvent } from '../../shared/visual-intelligence/types';

export interface InterviewHostDeps {
  config: ConfigurationService;
  session: SessionHost;
  audio: AudioHost;
  visual: VisualContextHost;
}

/**
 * Product-level interview orchestration. Does not replace SessionManager / AI / Context.
 */
export class InterviewHost {
  private readonly documents = new InterviewSessionContextStore();
  private readonly config: ConfigurationService;
  private readonly session: SessionHost;
  private readonly audio: AudioHost;
  private readonly visual: VisualContextHost;

  private phase: InterviewProductPhase = 'prepare';
  private executionMode: InterviewExecutionMode = 'real';
  private uiState: InterviewUiState = 'idle';
  private startedAt: number | null = null;
  private paused = false;
  private listening = false;
  private errorMessage: string | null = null;
  private summary: InterviewSummary | null = null;
  private questionCount = 0;
  private answersGenerated = 0;
  private visualAnalyses = 0;
  private errorCount = 0;
  private unsubscribers: Array<() => void> = [];

  constructor(deps: InterviewHostDeps) {
    this.config = deps.config;
    this.session = deps.session;
    this.audio = deps.audio;
    this.visual = deps.visual;
    this.bindPipelineEvents();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }

  getDocumentContext(): InterviewDocumentContext | null {
    const candidates = this.documents.getCandidates();
    if (candidates.length === 0) {
      return null;
    }
    // Full session document set — ContextBuilder applies question relevance.
    return {
      excerpts: candidates.map((doc) => ({
        id: doc.id,
        fileName: doc.fileName,
        kind: doc.kind,
        text: doc.text,
        relevanceScore: 0,
        relevanceReason: 'session_document',
        truncated: doc.truncated,
      })),
      resumeExcerpt: candidates.find((doc) => doc.kind === 'resume')?.text ?? null,
      jobDescriptionExcerpt:
        candidates.find((doc) => doc.kind === 'job_description')?.text ?? null,
      additionalExcerpts: candidates
        .filter((doc) => doc.kind === 'additional')
        .map((doc) => ({
          id: doc.id,
          fileName: doc.fileName,
          text: doc.text,
          truncated: doc.truncated,
        })),
    };
  }

  getDocuments(): InterviewSessionContextPublic {
    return this.documents.getPublic();
  }

  getStatus(): InterviewStatus {
    const sessionStatus = this.session.getManager().getStatus();
    const question = this.audio.getCurrentQuestion();
    const response = this.audio.getCurrentAiResponse();
    return {
      phase: this.phase,
      executionMode: this.executionMode,
      uiState: this.uiState,
      uiStateLabel: INTERVIEW_UI_STATE_LABELS[this.uiState],
      sessionId: sessionStatus.sessionId,
      startedAt: this.startedAt,
      paused: this.paused,
      listening: this.listening && !this.paused && this.executionMode === 'real',
      currentQuestionId: question?.id ?? null,
      currentQuestionText: question?.text ?? null,
      answerText: response?.text ?? '',
      answerStatus: response?.status ?? null,
      errorMessage: this.errorMessage,
      documents: this.documents.getPublic(),
      summary: this.summary,
    };
  }

  async pickAndAddDocument(kind: SessionDocumentKind): Promise<SessionDocumentMeta> {
    let result: Electron.OpenDialogReturnValue;
    try {
      result = await dialog.showOpenDialog({
        title:
          kind === 'resume'
            ? 'Upload resume'
            : kind === 'job_description'
              ? 'Upload job description'
              : 'Add document',
        properties: ['openFile'],
        filters: [
          { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
    } catch (error) {
      throw new AppError('INTERNAL', 'Unable to open the file picker.', {
        details: {
          code: 'DOCUMENT_DIALOG_FAILED',
          cause: error instanceof Error ? error.message : 'unknown',
        },
      });
    }

    if (result.canceled || result.filePaths.length === 0) {
      throw new AppError('VALIDATION', 'No file selected.', {
        details: { code: 'DOCUMENT_CANCELLED' },
      });
    }

    const filePath = result.filePaths[0]!;
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    let bytes: Buffer;
    try {
      bytes = await fs.readFile(filePath);
    } catch (error) {
      throw new AppError('VALIDATION', 'Selected file could not be read.', {
        details: {
          code: 'DOCUMENT_MISSING',
          cause: error instanceof Error ? error.message : 'unknown',
        },
      });
    }

    const fileName = path.basename(filePath);
    const meta = await this.documents.addDocument({
      kind,
      fileName,
      mimeType: null,
      bytes: new Uint8Array(bytes),
    });
    this.broadcast();
    return meta;
  }

  async addDocumentBytes(input: {
    kind: SessionDocumentKind;
    fileName: string;
    mimeType?: string | null;
    bytesBase64: string;
  }): Promise<SessionDocumentMeta> {
    const bytes = Buffer.from(input.bytesBase64, 'base64');
    const meta = await this.documents.addDocument({
      kind: input.kind,
      fileName: input.fileName,
      mimeType: input.mimeType ?? null,
      bytes: new Uint8Array(bytes),
    });
    this.broadcast();
    return meta;
  }

  removeDocument(id: string): InterviewSessionContextPublic {
    const docs = this.documents.removeDocument(id);
    this.broadcast();
    return docs;
  }

  /**
   * Product Start Interview — prepares session + enables automatic pipeline.
   * Renderer still starts microphone capture after this returns (real mode only).
   */
  async startInterview(options?: { mode?: InterviewExecutionMode }): Promise<InterviewStatus> {
    const mode = options?.mode ?? 'real';
    this.executionMode = mode;
    this.summary = null;
    this.errorMessage = null;
    this.questionCount = 0;
    this.answersGenerated = 0;
    this.visualAnalyses = 0;
    this.errorCount = 0;
    this.paused = false;

    // Ensure no leftover transient state from a prior session.
    try {
      this.audio.clearTranscript();
      this.audio.clearQuestions();
      await this.audio.clearAiResponses();
    } catch {
      // ignore
    }
    try {
      this.visual.clearIntelligenceResults();
    } catch {
      // ignore
    }

    // Enable automatic generation for the product flow.
    this.config.update({
      ai: { autoGenerate: true },
      visualIntelligence: {
        enabled: true,
        autoAnalyzeOnQuestion: mode === 'real',
      },
    });

    if (mode === 'simulation') {
      // Isolation: no Deepgram → question detection; no mic listening.
      this.audio.setQuestionProcessingEnabled(true);
      this.audio.setMicrophoneQuestionIngest(false);
      this.listening = false;
      this.uiState = 'idle';
      try {
        await this.audio.pause();
      } catch {
        // Audio may not be active yet.
      }
    } else {
      this.audio.setMicrophoneQuestionIngest(true);
      this.audio.setQuestionProcessingEnabled(true);
      this.listening = true;
      this.uiState = 'listening';
    }

    await this.visual.onSessionStart();
    this.session.getManager().start();

    this.phase = 'live';
    this.startedAt = Date.now();
    this.broadcast();
    logger.info('interview.started', {
      sessionId: this.session.getManager().getStatus().sessionId,
      documentCount: this.documents.getPublic().documentCount,
      executionMode: mode,
    });
    return this.getStatus();
  }

  /** Switch an already-live session into simulation isolation (no mic questions). */
  async enterSimulationMode(): Promise<InterviewStatus> {
    this.executionMode = 'simulation';
    this.listening = false;
    this.audio.setMicrophoneQuestionIngest(false);
    this.audio.setQuestionProcessingEnabled(true);
    try {
      await this.audio.cancelAi();
    } catch {
      // ignore
    }
    try {
      await this.audio.pause();
    } catch {
      // ignore
    }
    this.uiState = 'idle';
    this.broadcast();
    logger.info('interview.execution_mode', { executionMode: 'simulation' });
    return this.getStatus();
  }

  async exitSimulationMode(): Promise<InterviewStatus> {
    this.executionMode = 'real';
    this.audio.setMicrophoneQuestionIngest(true);
    if (this.phase === 'live' && !this.paused) {
      this.listening = true;
      this.audio.setQuestionProcessingEnabled(true);
      this.uiState = 'listening';
    }
    this.broadcast();
    logger.info('interview.execution_mode', { executionMode: 'real' });
    return this.getStatus();
  }

  getExecutionMode(): InterviewExecutionMode {
    return this.executionMode;
  }

  markListeningActive(): InterviewStatus {
    // Simulation never drives state from the microphone.
    if (this.executionMode === 'simulation') {
      this.listening = false;
      return this.getStatus();
    }
    if (this.phase === 'live' && !this.paused) {
      this.listening = true;
      this.uiState = this.uiState === 'idle' ? 'listening' : this.uiState;
      this.broadcast();
    }
    return this.getStatus();
  }

  async pauseInterview(): Promise<InterviewStatus> {
    if (this.phase !== 'live') {
      return this.getStatus();
    }
    this.paused = true;
    this.uiState = 'paused';
    this.listening = false;
    this.audio.setQuestionProcessingEnabled(false);
    try {
      await this.audio.cancelAi();
    } catch {
      // ignore
    }
    try {
      await this.audio.pause();
    } catch {
      // Audio may not be active yet — still pause product state.
    }
    try {
      await this.visual.onSessionPause();
    } catch {
      // ignore
    }
    this.session.getManager().pause();
    this.broadcast();
    return this.getStatus();
  }

  async resumeInterview(): Promise<InterviewStatus> {
    if (this.phase !== 'live') {
      return this.getStatus();
    }
    this.paused = false;
    this.errorMessage = null;
    if (this.executionMode === 'simulation') {
      this.listening = false;
      this.audio.setMicrophoneQuestionIngest(false);
      this.audio.setQuestionProcessingEnabled(true);
      this.uiState = 'idle';
      // Do not resume Deepgram / microphone capture in simulation.
    } else {
      this.uiState = 'listening';
      this.listening = true;
      this.audio.setMicrophoneQuestionIngest(true);
      this.audio.setQuestionProcessingEnabled(true);
      try {
        await this.audio.resume();
      } catch {
        // ignore
      }
    }
    try {
      await this.visual.onSessionResume();
    } catch {
      // ignore
    }
    this.session.getManager().resume();
    this.broadcast();
    return this.getStatus();
  }

  async endInterview(): Promise<InterviewStatus> {
    const durationMs = this.startedAt ? Date.now() - this.startedAt : 0;
    try {
      await this.audio.cancelAi();
    } catch {
      // ignore
    }
    try {
      await this.audio.forceStopFromSession();
    } catch {
      // ignore
    }
    try {
      this.audio.clearTranscript();
    } catch {
      // ignore
    }
    try {
      await this.visual.onSessionStop();
    } catch {
      // ignore
    }
    try {
      this.visual.clearIntelligenceResults();
    } catch {
      // ignore
    }
    this.session.getManager().stop();

    // Disable automatic generation until the next Start Interview.
    try {
      this.config.update({
        ai: { autoGenerate: false },
        visualIntelligence: { autoAnalyzeOnQuestion: false },
      });
    } catch {
      // ignore
    }

    this.summary = {
      durationMs,
      questionCount: this.questionCount,
      answersGenerated: this.answersGenerated,
      visualAnalyses: this.visualAnalyses,
      errorCount: this.errorCount,
      endedAt: Date.now(),
    };
    this.phase = 'summary';
    this.uiState = 'idle';
    this.paused = false;
    this.listening = false;
    this.executionMode = 'real';
    this.audio.setMicrophoneQuestionIngest(true);
    this.startedAt = null;
    this.broadcast();
    logger.info('interview.ended', {
      durationMs: this.summary.durationMs,
      questionCount: this.summary.questionCount,
      answersGenerated: this.summary.answersGenerated,
      visualAnalyses: this.summary.visualAnalyses,
      errorCount: this.summary.errorCount,
    });
    return this.getStatus();
  }

  newInterview(): InterviewStatus {
    this.documents.clear();
    try {
      this.audio.clearTranscript();
      this.audio.clearQuestions();
      void this.audio.clearAiResponses();
    } catch {
      // ignore
    }
    try {
      this.visual.clear();
    } catch {
      // ignore
    }
    this.summary = null;
    this.phase = 'prepare';
    this.uiState = 'idle';
    this.errorMessage = null;
    this.questionCount = 0;
    this.answersGenerated = 0;
    this.visualAnalyses = 0;
    this.errorCount = 0;
    this.paused = false;
    this.listening = false;
    this.startedAt = null;
    this.executionMode = 'real';
    this.audio.setMicrophoneQuestionIngest(true);
    this.broadcast();
    logger.info('interview.new', {});
    return this.getStatus();
  }

  async submitManualQuestion(text: string): Promise<InterviewStatus> {
    if (this.phase !== 'live' || this.paused) {
      throw new AppError('SESSION', 'Start or resume the interview to submit a question.');
    }
    if (this.executionMode === 'simulation') {
      throw new AppError(
        'SESSION',
        'Microphone/manual questions are disabled during Interview Simulation. Use Next Question.',
      );
    }
    this.uiState = 'question_detected';
    this.broadcast();
    const produced = this.audio.processManualQuestion(text);
    if (produced.length === 0) {
      this.uiState = 'listening';
      this.errorMessage = 'That text did not look like a question. Try again.';
      this.broadcast();
    }
    return this.getStatus();
  }

  /**
   * Inject a simulation interviewer question (no STT / no duplicate detector).
   */
  async submitSimulatedQuestion(
    text: string,
    options?: {
      simulationQuestionId?: string;
      expectedType?: import('../../shared/questions/types').QuestionType;
      isFollowUp?: boolean;
      parentQuestionId?: string | null;
    },
  ): Promise<{ status: InterviewStatus; runtimeQuestionId: string | null }> {
    if (this.phase !== 'live') {
      throw new AppError('SESSION', 'Start the interview simulation first.');
    }
    if (this.executionMode !== 'simulation') {
      throw new AppError('SESSION', 'Simulation questions require simulation execution mode.');
    }
    this.uiState = 'question_detected';
    this.errorMessage = null;
    this.broadcast();
    const produced = this.audio.processSimulatedQuestion(text, options);
    if (produced.length === 0) {
      this.uiState = 'error';
      this.errorMessage = 'Simulation could not process this interviewer question.';
      this.broadcast();
      return { status: this.getStatus(), runtimeQuestionId: null };
    }
    return {
      status: this.getStatus(),
      runtimeQuestionId: produced[0]?.id ?? null,
    };
  }

  async regenerate(): Promise<InterviewStatus> {
    if (this.phase !== 'live' || this.paused) {
      throw new AppError('SESSION', 'Resume the interview to regenerate an answer.');
    }
    const question = this.audio.getCurrentQuestion();
    if (!question) {
      throw new AppError('VALIDATION', 'No current question to regenerate.');
    }
    this.uiState = 'generating';
    this.errorMessage = null;
    this.broadcast();
    try {
      await this.audio.generateAiAnswer(question.id);
    } catch (error) {
      this.errorCount += 1;
      this.uiState = 'error';
      this.errorMessage = friendlyAiError(error);
      this.broadcast();
      throw error;
    }
    return this.getStatus();
  }

  private bindPipelineEvents(): void {
    this.unsubscribers.push(
      this.audio.subscribeQuestions((event: QuestionEvent) => {
        if (this.phase !== 'live' || this.paused) return;
        if (event.type === 'question.classified' && event.question) {
          this.questionCount += 1;
          this.uiState = 'building_context';
          this.errorMessage = null;
          this.broadcast();
        }
      }),
    );
    this.unsubscribers.push(
      this.audio.subscribeAi((event: AIEvent) => {
        if (this.phase !== 'live') return;
        // Pause must not flip UI to generating/ready while the interview is paused.
        if (this.paused) {
          if (event.type === 'ai.response.cancelled') {
            this.uiState = 'paused';
            this.broadcast();
          }
          return;
        }
        if (event.type === 'ai.request.started' || event.type === 'ai.response.started') {
          this.uiState = 'generating';
          this.broadcast();
        } else if (event.type === 'ai.response.chunk') {
          this.uiState = 'generating';
          this.broadcast();
        } else if (event.type === 'ai.response.completed') {
          this.answersGenerated += 1;
          this.uiState = 'ready';
          this.errorMessage = null;
          this.broadcast();
        } else if (event.type === 'ai.response.error') {
          this.errorCount += 1;
          this.uiState = 'error';
          this.errorMessage = friendlyAiError(event.error);
          this.broadcast();
        } else if (event.type === 'ai.response.cancelled') {
          this.uiState = 'listening';
          this.broadcast();
        }
      }),
    );
    this.unsubscribers.push(
      this.visual.subscribeIntelligence((event: VisualIntelligenceEvent) => {
        if (this.phase !== 'live' || this.paused) return;
        if (event.type === 'visual.ocr.started' || event.type === 'visual.vision.started') {
          this.uiState = 'analyzing_visual';
          this.broadcast();
        } else if (
          event.type === 'visual.vision.completed' ||
          event.type === 'visual.ocr.completed'
        ) {
          this.visualAnalyses += 1;
          this.broadcast();
        } else if (event.type === 'visual.ocr.failed' || event.type === 'visual.vision.failed') {
          // Non-fatal — continue interview without visual context.
          logger.warn('interview.visual_nonfatal', {
            code: event.code,
            message: event.message,
          });
        }
      }),
    );
  }

  private broadcast(): void {
    const status = this.getStatus();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcEvents.INTERVIEW_STATUS_CHANGED, status);
      }
    }
  }
}

function friendlyAiError(error: unknown): string {
  const message =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : error instanceof Error
        ? error.message
        : 'AI generation failed';
  const details =
    error instanceof AppError && error.details && typeof error.details === 'object'
      ? (error.details as Record<string, unknown>)
      : null;
  const category = typeof details?.category === 'string' ? details.category : '';

  if (category === 'quota_billing' || /quota|billing|insufficient/i.test(message)) {
    return 'AI generation is currently unavailable because the OpenAI account quota or billing limit was reached.';
  }
  if (category === 'rate_limit' || /rate.?limit|429/i.test(message)) {
    return 'AI generation is temporarily rate-limited. Try again in a moment.';
  }
  if (category === 'authentication' || /auth|401|403|api.?key|credential/i.test(message)) {
    return 'AI generation is currently unavailable. Check your OpenAI API key in Settings.';
  }
  if (category === 'missing_credential' || /not configured/i.test(message)) {
    return 'AI generation is currently unavailable. Add your OpenAI API key in Settings.';
  }
  if (category === 'invalid_request') {
    return 'AI generation failed because the request configuration was rejected. Check the AI model settings.';
  }
  if (category === 'network' || /network/i.test(message)) {
    return 'AI generation failed due to a network problem. Check your connection and try again.';
  }
  return 'AI generation is currently unavailable. You can try Regenerate in a moment.';
}
