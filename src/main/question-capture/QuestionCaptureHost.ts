import { BrowserWindow, globalShortcut } from 'electron';
import { HotkeyValidator } from '../../core/question-capture/HotkeyValidator';
import { CapturedQuestionExtractor } from '../../core/question-capture/CapturedQuestionExtractor';
import { QuestionCaptureSession } from '../../core/question-capture/QuestionCaptureSession';
import type {
  CapturedQuestion,
  QuestionCaptureEvent,
  QuestionCaptureMode,
  QuestionCapturePhase,
  QuestionCapturePublicConfig,
  QuestionCaptureRegion,
  QuestionCaptureStatus,
} from '../../shared/question-capture/types';
import type { ProblemResult } from '../../shared/problem-intelligence/types';
import { IpcEvents } from '../../shared/ipc/channels';
import { AppError } from '../../shared/errors';
import { selectCaptureRegion } from './selectCaptureRegion';
import { createDefaultIdGenerator } from '../../shared/session/types';
import { logger } from '../services/logging';
import type { VisualContextHost } from '../visual/VisualContextHost';
import type { InterviewHost } from '../interview/InterviewHost';
import type { ProblemIntelligenceHost } from '../problem-intelligence/ProblemIntelligenceHost';
import type { AudioHost } from '../services/audio/AudioHost';

export type QuestionCaptureListener = (event: QuestionCaptureEvent) => void;

export interface QuestionCaptureHostOptions {
  getConfig: () => QuestionCapturePublicConfig;
  persistConfig: (patch: Partial<QuestionCapturePublicConfig>) => void;
  visual: () => VisualContextHost;
  interview: () => InterviewHost;
  problemIntelligence: () => ProblemIntelligenceHost;
  audio: () => AudioHost;
  isInterviewLive: () => boolean;
  isInterviewPaused: () => boolean;
}

/**
 * User-triggered question capture: hotkey → select → confirm → OCR/Vision → answer.
 */
export class QuestionCaptureHost {
  private readonly getConfig: QuestionCaptureHostOptions['getConfig'];
  private readonly persistConfig: QuestionCaptureHostOptions['persistConfig'];
  private readonly visual: QuestionCaptureHostOptions['visual'];
  private readonly interview: QuestionCaptureHostOptions['interview'];
  private readonly problemIntelligence: QuestionCaptureHostOptions['problemIntelligence'];
  private readonly audio: QuestionCaptureHostOptions['audio'];
  private readonly isInterviewLive: QuestionCaptureHostOptions['isInterviewLive'];
  private readonly isInterviewPaused: QuestionCaptureHostOptions['isInterviewPaused'];

  private readonly validator = new HotkeyValidator();
  private readonly extractor = new CapturedQuestionExtractor();
  private readonly session = new QuestionCaptureSession();
  private readonly listeners = new Set<QuestionCaptureListener>();
  private readonly createId = createDefaultIdGenerator();

  private phase: QuestionCapturePhase = 'idle';
  private enabled = true;
  private hotkeyRegistered = false;
  private hotkeyError: string | null = null;
  private activeCaptureId: string | null = null;
  private lastError: string | null = null;
  private lastCapturedQuestionId: string | null = null;
  private abortAnalyze: AbortController | null = null;
  private registeredHotkey: string | null = null;

  constructor(options: QuestionCaptureHostOptions) {
    this.getConfig = options.getConfig;
    this.persistConfig = options.persistConfig;
    this.visual = options.visual;
    this.interview = options.interview;
    this.problemIntelligence = options.problemIntelligence;
    this.audio = options.audio;
    this.isInterviewLive = options.isInterviewLive;
    this.isInterviewPaused = options.isInterviewPaused;
  }

  subscribe(listener: QuestionCaptureListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): QuestionCaptureStatus {
    const config = this.getConfig();
    return {
      phase: this.phase,
      hotkey: config.hotkey,
      hotkeyRegistered: this.hotkeyRegistered,
      hotkeyError: this.hotkeyError,
      captureMode: config.captureMode,
      activeCaptureId: this.activeCaptureId,
      lastError: this.lastError,
      lastCapturedQuestionId: this.lastCapturedQuestionId,
      enabled: this.enabled,
    };
  }

  registerHotkey(): QuestionCaptureStatus {
    const parsed = this.validator.parse(this.getConfig().hotkey);
    if (!parsed.ok) {
      this.hotkeyRegistered = false;
      this.hotkeyError = parsed.reason;
      return this.getStatus();
    }
    this.unregisterHotkey();
    try {
      const ok = globalShortcut.register(parsed.normalized, () => {
        void this.beginCaptureFromHotkey();
      });
      if (!ok) {
        this.hotkeyRegistered = false;
        this.hotkeyError = 'Shortcut conflict — choose a different hotkey.';
        this.registeredHotkey = null;
      } else {
        this.hotkeyRegistered = true;
        this.hotkeyError = null;
        this.registeredHotkey = parsed.normalized;
        if (parsed.normalized !== this.getConfig().hotkey) {
          this.persistConfig({ hotkey: parsed.normalized });
        }
      }
    } catch (error) {
      this.hotkeyRegistered = false;
      this.hotkeyError = error instanceof Error ? error.message : 'Hotkey registration failed.';
      this.registeredHotkey = null;
    }
    this.emit({ type: 'capture.hotkey_changed', timestamp: Date.now(), status: this.getStatus() });
    return this.getStatus();
  }

  unregisterHotkey(): void {
    if (this.registeredHotkey) {
      try {
        globalShortcut.unregister(this.registeredHotkey);
      } catch {
        // ignore
      }
    }
    this.registeredHotkey = null;
    this.hotkeyRegistered = false;
  }

  updateConfig(patch: Partial<QuestionCapturePublicConfig>): QuestionCaptureStatus {
    if (patch.hotkey != null) {
      const parsed = this.validator.parse(patch.hotkey);
      if (!parsed.ok) {
        throw new AppError('VALIDATION', parsed.reason);
      }
      patch = { ...patch, hotkey: parsed.normalized };
    }
    if (patch.captureMode != null && !this.validator.isValidMode(patch.captureMode)) {
      throw new AppError('VALIDATION', 'Invalid capture mode.');
    }
    this.persistConfig(patch);
    if (patch.hotkey != null) {
      this.registerHotkey();
    }
    return this.getStatus();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      void this.cancel();
    }
  }

  async beginCaptureFromHotkey(): Promise<void> {
    if (!this.enabled) return;
    if (!this.isInterviewLive() || this.isInterviewPaused()) {
      this.lastError = 'Start or resume the interview to capture a question.';
      this.emit({
        type: 'capture.failed',
        timestamp: Date.now(),
        message: this.lastError,
        status: this.getStatus(),
      });
      return;
    }
    if (this.phase === 'selecting' || this.phase === 'analyzing' || this.phase === 'preview') {
      return; // duplicate prevention
    }
    await this.startCapture();
  }

  async startCapture(): Promise<QuestionCaptureStatus> {
    if (this.phase === 'selecting' || this.phase === 'analyzing') {
      throw new AppError('SESSION', 'A capture is already in progress.');
    }
    if (!this.isInterviewLive() || this.isInterviewPaused()) {
      throw new AppError('SESSION', 'Start or resume the interview to capture a question.');
    }

    const captureId = this.createId();
    this.activeCaptureId = captureId;
    this.lastError = null;
    this.phase = 'selecting';
    this.emit({ type: 'capture.started', timestamp: Date.now(), captureId, status: this.getStatus() });

    const mode = this.getConfig().captureMode;
    try {
      if (mode === 'region') {
        const result = await selectCaptureRegion();
        if (result.action === 'cancelled') {
          this.phase = 'cancelled';
          this.activeCaptureId = null;
          this.emit({
            type: 'capture.cancelled',
            timestamp: Date.now(),
            captureId,
            status: this.getStatus(),
          });
          this.phase = 'idle';
          return this.getStatus();
        }
        // User already confirmed Analyze in overlay
        return this.analyzePending(captureId, mode, result.region);
      }

      // active_window / full_screen — capture immediately after hotkey (still user-triggered)
      return this.analyzePending(captureId, mode, null);
    } catch (error) {
      this.phase = 'error';
      this.lastError =
        error instanceof AppError
          ? error.message
          : 'Capture failed. Check screen recording permissions.';
      this.emit({
        type: 'capture.failed',
        timestamp: Date.now(),
        captureId,
        message: this.lastError,
        status: this.getStatus(),
      });
      this.phase = 'idle';
      this.activeCaptureId = null;
      return this.getStatus();
    }
  }

  async cancel(): Promise<QuestionCaptureStatus> {
    this.abortAnalyze?.abort();
    this.abortAnalyze = null;
    await this.visual().cancelIntelligence().catch(() => undefined);
    this.phase = 'cancelled';
    const id = this.activeCaptureId;
    this.activeCaptureId = null;
    this.emit({
      type: 'capture.cancelled',
      timestamp: Date.now(),
      captureId: id ?? undefined,
      status: this.getStatus(),
    });
    this.phase = 'idle';
    return this.getStatus();
  }

  async selectMultipleQuestion(index: number): Promise<QuestionCaptureStatus> {
    this.session.setSelectedMultipleIndex(index);
    const previous = this.session.getPrevious();
    if (!previous || !previous.multipleQuestions[index]) {
      throw new AppError('VALIDATION', 'Invalid question selection.');
    }
    const chosen = previous.multipleQuestions[index]!;
    await this.publishAnswer(
      {
        ...previous,
        cleanedText: chosen,
        multipleQuestions: [],
      },
      null,
    );
    return this.getStatus();
  }

  resetForSessionStop(): void {
    void this.cancel();
    this.session.reset();
    this.lastCapturedQuestionId = null;
  }

  dispose(): void {
    this.unregisterHotkey();
    void this.cancel();
    this.listeners.clear();
  }

  private async analyzePending(
    captureId: string,
    mode: QuestionCaptureMode,
    region: QuestionCaptureRegion | null,
  ): Promise<QuestionCaptureStatus> {
    this.phase = 'analyzing';
    this.emit({ type: 'capture.analyzing', timestamp: Date.now(), captureId, status: this.getStatus() });
    this.abortAnalyze = new AbortController();

    try {
      // Ensure visual capture is enabled for this explicit action
      try {
        this.visual().enable();
        this.visual().resume();
      } catch {
        // may already be enabled
      }

      const frameRef = await this.visual().captureNow(
        mode === 'region' && region
          ? { sourceKind: 'REGION', region }
          : mode === 'active_window'
            ? { sourceKind: 'WINDOW' }
            : { sourceKind: 'DISPLAY' },
      );

      if (this.abortAnalyze.signal.aborted) {
        throw new AppError('SESSION', 'Capture cancelled.');
      }

      const analysis = await this.visual().analyzeCurrent(true);
      if (analysis.skipped && analysis.skipReason === 'no_frame') {
        throw new AppError(
          'PROVIDER',
          'Unable to read the question clearly. Please capture a larger or clearer region.',
        );
      }

      const snapshot = this.visual().getSnapshot();
      const ocrText =
        snapshot.ocrResults
          ?.filter((r) => r.sourceFrameId === frameRef.id || !frameRef.id)
          .map((r) => r.text)
          .filter(Boolean)
          .join('\n') ||
        snapshot.ocrResults?.map((r) => r.text).filter(Boolean).join('\n') ||
        null;
      const visionText =
        snapshot.visionAnalyses?.map((v) => v.relevantText).filter(Boolean).join('\n') || null;
      const visionDescription =
        snapshot.visionAnalyses?.map((v) => v.description).filter(Boolean).join('\n') || null;

      const captured = this.extractor.extract({
        frameId: frameRef.id,
        ocrText,
        visionText,
        visionDescription,
        previousCleanedText: this.session.getPrevious()?.cleanedText ?? null,
      });

      if (!captured.cleanedText) {
        this.phase = 'error';
        this.lastError = captured.warnings[0] ?? 'Unable to read the question clearly.';
        this.emit({
          type: 'capture.failed',
          timestamp: Date.now(),
          captureId,
          message: this.lastError,
          captured,
          status: this.getStatus(),
        });
        this.phase = 'idle';
        this.activeCaptureId = null;
        return this.getStatus();
      }

      if (captured.multipleQuestions.length > 1) {
        this.session.push(captured);
        this.phase = 'preview';
        this.emit({
          type: 'capture.multiple_questions',
          timestamp: Date.now(),
          captureId,
          questions: captured.multipleQuestions,
          captured,
          status: this.getStatus(),
        });
        this.broadcastMain();
        return this.getStatus();
      }

      if (
        (captured.detectedQuestionType === 'coding' ||
          captured.detectedQuestionType === 'algorithm' ||
          captured.detectedQuestionType === 'debugging' ||
          captured.detectedQuestionType === 'code_output') &&
        captured.detectedLanguage === 'unknown'
      ) {
        this.session.push(captured);
        this.emit({
          type: 'capture.language_required',
          timestamp: Date.now(),
          captureId,
          captured,
          message: 'Select a language to continue.',
          status: this.getStatus(),
        });
        // Still attempt with unknown — Problem Intelligence will warn
      }

      let problemResult: ProblemResult | null = null;
      const problemTypes = new Set([
        'coding',
        'sql',
        'code_output',
        'debugging',
        'algorithm',
        'database',
      ]);

      if (captured.isFollowUp && this.session.getPrevious()) {
        const prev = this.session.getPrevious()!;
        if (problemTypes.has(prev.detectedQuestionType) || problemTypes.has(captured.detectedQuestionType)) {
          const latest = this.problemIntelligence().getCurrent();
          if (latest) {
            problemResult = await this.problemIntelligence().revise({
              problemId: latest.problemId,
              constraintDelta: captured.cleanedText,
              language: captured.detectedLanguage === 'unknown' ? 'auto' : captured.detectedLanguage,
              sqlDialect:
                captured.detectedSqlDialect === 'unknown' ? 'auto' : captured.detectedSqlDialect,
            });
          }
        }
      }

      if (!problemResult && problemTypes.has(captured.detectedQuestionType)) {
        problemResult = await this.problemIntelligence().createAndSolve({
          text: captured.cleanedText,
          source: 'visual_capture',
          language: captured.detectedLanguage === 'unknown' ? 'auto' : captured.detectedLanguage,
          sqlDialect:
            captured.detectedSqlDialect === 'unknown' ? 'auto' : captured.detectedSqlDialect,
          existingCode: captured.detectedCode,
        });
      }

      this.session.push(captured);
      this.lastCapturedQuestionId = captured.id;
      await this.publishAnswer(captured, problemResult);

      this.phase = 'idle';
      this.activeCaptureId = null;
      this.emit({
        type: 'capture.completed',
        timestamp: Date.now(),
        captureId,
        captured,
        status: this.getStatus(),
      });
      // Clear frame bytes after processing — privacy
      try {
        this.visual().clear();
      } catch {
        // ignore
      }
      return this.getStatus();
    } catch (error) {
      this.phase = 'error';
      this.lastError =
        error instanceof AppError
          ? error.message
          : 'Unable to analyze the captured question.';
      logger.warn('question_capture.analyze_failed', {
        message: this.lastError,
        // never log screenshot bytes
      });
      this.emit({
        type: 'capture.failed',
        timestamp: Date.now(),
        captureId,
        message: this.lastError,
        status: this.getStatus(),
      });
      this.phase = 'idle';
      this.activeCaptureId = null;
      try {
        this.visual().clear();
      } catch {
        // ignore
      }
      return this.getStatus();
    } finally {
      this.abortAnalyze = null;
    }
  }

  private async publishAnswer(
    captured: CapturedQuestion,
    problemResult: ProblemResult | null,
  ): Promise<void> {
    const answer = problemResult
      ? formatProblemAnswer(captured, problemResult)
      : null;

    if (answer) {
      this.audio().suppressNextAiAutoGenerate();
      const produced = this.audio().processManualQuestion(captured.cleanedText);
      const question = produced[0];
      if (!question) {
        // Fallback to normal submit
        await this.interview().submitManualQuestion(captured.cleanedText);
        return;
      }
      await this.audio().cancelAi().catch(() => null);
      this.audio().publishExternalAnswer(question.id, answer);
      return;
    }

    await this.interview().submitManualQuestion(captured.cleanedText);
  }

  private emit(event: QuestionCaptureEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // isolate
      }
    }
    this.broadcastMain(event);
  }

  private broadcastMain(event?: QuestionCaptureEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcEvents.QUESTION_CAPTURE_EVENT, event ?? {
          type: 'capture.started',
          timestamp: Date.now(),
          status: this.getStatus(),
        });
      }
    }
  }
}

function formatProblemAnswer(captured: CapturedQuestion, result: ProblemResult): string {
  const lines: string[] = [];
  lines.push(`Detected: ${result.type}`);
  if (result.language !== 'unknown') lines.push(`Language: ${result.language}`);
  if (result.sqlDialect !== 'unknown') lines.push(`SQL dialect: ${result.sqlDialect}`);
  lines.push('');
  lines.push(result.explanation || result.solution.explanation);
  if (result.solution.algorithm) {
    lines.push('');
    lines.push('Approach');
    lines.push(result.solution.algorithm);
  }
  const code = result.solution.code ?? result.solution.correctedCode ?? result.solution.sql;
  if (code) {
    lines.push('');
    lines.push('Code');
    lines.push(code);
  }
  if (result.complexity) {
    lines.push('');
    lines.push('Complexity');
    lines.push(`Time: ${result.complexity.timeComplexity}`);
    lines.push(`Space: ${result.complexity.spaceComplexity}`);
  }
  if (result.executionResult?.stdout) {
    lines.push('');
    lines.push('Output');
    lines.push(result.executionResult.stdout);
  }
  if (result.sqlExecutionResult?.table) {
    lines.push('');
    lines.push('Output');
    lines.push(JSON.stringify(result.sqlExecutionResult.table, null, 2));
  }
  lines.push('');
  lines.push(`Verification: ${result.verificationStatus}`);
  if (result.warnings.length) {
    lines.push('');
    lines.push('Warnings');
    for (const w of result.warnings) lines.push(`- ${w}`);
  }
  if (captured.warnings.length) {
    for (const w of captured.warnings) lines.push(`- ${w}`);
  }
  return lines.join('\n');
}
