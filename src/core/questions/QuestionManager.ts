import type { TranscriptSegment } from '../../shared/transcription/types';
import type {
  DetectedQuestion,
  QuestionEvent,
  QuestionPipelineStatus,
  QuestionStatusSnapshot,
  QuestionType,
} from '../../shared/questions/types';
import { DETECTION_CONFIDENCE, QUESTION_BUFFER } from '../../shared/questions/types';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';
import { QuestionTranscriptBuffer } from './QuestionTranscriptBuffer';
import { QuestionDetector } from './QuestionDetector';
import { QuestionNormalizer } from './QuestionNormalizer';
import { QuestionClassifier } from './QuestionClassifier';
import { QuestionDuplicateDetector } from './QuestionDuplicateDetector';
import { QuestionContext } from './QuestionContext';

export type QuestionListener = (event: QuestionEvent) => void;

export interface QuestionManagerOptions {
  idGenerator?: IdGenerator;
  sessionId?: () => string | null;
  correlationId?: () => string | null;
  onLog?: (event: string, meta: Record<string, unknown>) => void;
}

/**
 * Orchestrates buffer → detect → normalize → classify → dedupe.
 * Pure local processing — no network / LLM.
 */
export class QuestionManager {
  private enabled = true;
  private readonly buffer = new QuestionTranscriptBuffer();
  private readonly detector = new QuestionDetector();
  private readonly normalizer = new QuestionNormalizer();
  private readonly classifier = new QuestionClassifier();
  private readonly duplicates = new QuestionDuplicateDetector();
  private readonly context: QuestionContext;
  private readonly listeners = new Set<QuestionListener>();
  private readonly createId: IdGenerator;
  private readonly getSessionId: () => string | null;
  private readonly getCorrelationId: () => string | null;
  private readonly onLog: (event: string, meta: Record<string, unknown>) => void;
  private lastProcessedAt: number | null = null;
  private current: DetectedQuestion | null = null;

  constructor(options: QuestionManagerOptions = {}) {
    this.createId = options.idGenerator ?? createDefaultIdGenerator();
    this.getSessionId = options.sessionId ?? (() => null);
    this.getCorrelationId = options.correlationId ?? (() => null);
    this.onLog = options.onLog ?? (() => undefined);
    this.context = new QuestionContext();
  }

  subscribe(listener: QuestionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.buffer.clear();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  processFinalSegment(segment: TranscriptSegment): DetectedQuestion[] {
    if (!this.enabled) {
      return [];
    }

    this.context.addSegment(segment);
    const utterances = this.buffer.push(segment);
    const produced: DetectedQuestion[] = [];

    for (const utterance of utterances) {
      produced.push(...this.processUtterance(utterance.text, utterance.sourceSegmentIds, utterance.timestamp));
    }

    return produced;
  }

  /**
   * Manual / pasted question — same detect → classify → emit pipeline as speech.
   */
  processManualText(text: string): DetectedQuestion[] {
    if (!this.enabled) {
      return [];
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return [];
    }
    const asQuestion = /[?？]\s*$/.test(trimmed) ? trimmed : `${trimmed}?`;
    return this.processUtterance(asQuestion, ['manual'], Date.now());
  }

  /**
   * Simulated interviewer question — classify + emit, but NEVER use duplicate detection.
   * Used by Java interview simulation only (not Deepgram / STT).
   */
  processSimulatedText(
    text: string,
    options?: {
      simulationQuestionId?: string;
      expectedType?: QuestionType;
      isFollowUp?: boolean;
      parentQuestionId?: string | null;
    },
  ): DetectedQuestion[] {
    if (!this.enabled) {
      return [];
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return [];
    }
    const asQuestion = /[?？]\s*$/.test(trimmed) ? trimmed : `${trimmed}?`;
    return this.processSimulatedUtterance(asQuestion, Date.now(), options);
  }

  /** Flush any pending buffered segments (e.g. on stop). */
  flush(): DetectedQuestion[] {
    if (!this.enabled) {
      this.buffer.clear();
      return [];
    }
    const produced: DetectedQuestion[] = [];
    for (const utterance of this.buffer.flush()) {
      produced.push(...this.processUtterance(utterance.text, utterance.sourceSegmentIds, utterance.timestamp));
    }
    return produced;
  }

  clear(): void {
    this.buffer.clear();
    this.context.clear();
    this.current = null;
    this.lastProcessedAt = null;
  }

  resetForSessionStop(): void {
    this.setEnabled(false);
    this.flush();
    this.clear();
  }

  getRecent(limit = 20): DetectedQuestion[] {
    return this.context.getRecentQuestions().slice(-limit);
  }

  getCurrent(): DetectedQuestion | null {
    return this.current ? structuredClone(this.current) : null;
  }

  getStatus(): QuestionStatusSnapshot {
    return {
      enabled: this.enabled,
      questionCount: this.context.getRecentQuestions().length,
      currentQuestionId: this.current?.id ?? null,
      maxQuestions: QUESTION_BUFFER.MAX_RECENT_QUESTIONS,
      lastProcessedAt: this.lastProcessedAt,
    };
  }

  getPipelineStatus(): QuestionPipelineStatus {
    return {
      listening: this.enabled,
      enabled: this.enabled,
      recentCount: this.context.getRecentQuestions().length,
      current: this.getCurrent(),
    };
  }

  private processUtterance(
    text: string,
    sourceSegmentIds: string[],
    timestamp: number,
  ): DetectedQuestion[] {
    this.lastProcessedAt = Date.now();
    const candidates = this.detector.detect(text, {
      hasRecentQuestion: this.context.hasRecentQuestion(),
    });

    if (candidates.length === 0) {
      this.onLog('question.ignored', {
        reason: 'no_question_signal',
        sourceSegmentCount: sourceSegmentIds.length,
      });
      return [];
    }

    const produced: DetectedQuestion[] = [];

    for (const candidate of candidates) {
      if (candidate.detectionConfidence < DETECTION_CONFIDENCE.IGNORE_BELOW) {
        continue;
      }

      const { originalText, normalizedText } = this.normalizer.normalize(candidate.text);
      const related = this.duplicates.findRelated(
        normalizedText,
        this.context.getRecentQuestions(),
        sourceSegmentIds,
        timestamp,
      );
      if (related.question && related.relation !== 'extension') {
        this.onLog('question.ignored', {
          reason: related.relation === 'prefix' ? 'duplicate_prefix' : 'duplicate',
          questionId: related.question.id,
        });
        this.emit({
          type: 'question.ignored',
          questionId: related.question.id,
          timestamp: Date.now(),
          sessionId: this.getSessionId(),
          correlationId: this.getCorrelationId(),
          reason: related.relation === 'prefix' ? 'duplicate_prefix' : 'duplicate',
          question: related.question,
        });
        continue;
      }

      if (related.question && related.relation === 'extension') {
        const updated: DetectedQuestion = {
          ...related.question,
          text: normalizedText,
          originalText,
          normalizedText,
          timestamp,
          sourceSegmentIds: Array.from(
            new Set([...related.question.sourceSegmentIds, ...sourceSegmentIds]),
          ),
          detectionConfidence: Math.max(
            related.question.detectionConfidence,
            candidate.detectionConfidence,
          ),
          isMultiPart: candidate.isMultiPart || related.question.isMultiPart,
          parts: candidate.parts.length > 0 ? candidate.parts : related.question.parts,
        };
        this.context.replaceQuestion(updated);
        this.current = updated;
        this.onLog('question.updated', {
          questionId: updated.id,
          detectionConfidence: updated.detectionConfidence,
          classification: updated.type,
          classificationConfidence: updated.classificationConfidence,
          sessionId: this.getSessionId(),
          correlationId: this.getCorrelationId(),
        });
        this.emit({
          type: 'question.updated',
          questionId: updated.id,
          timestamp: Date.now(),
          sessionId: this.getSessionId(),
          correlationId: this.getCorrelationId(),
          question: updated,
        });
        continue;
      }

      const classification = this.classifier.classify(normalizedText, {
        isFollowUp: candidate.isFollowUp,
        isClarification: candidate.isClarification,
        isMultiPart: candidate.isMultiPart,
      });

      const parent = this.context.getLastQuestion();
      const question: DetectedQuestion = {
        id: this.createId(),
        text: normalizedText,
        originalText,
        normalizedText,
        type: classification.type,
        status: 'classified',
        timestamp,
        sourceSegmentIds: [...sourceSegmentIds],
        detectionConfidence: candidate.detectionConfidence,
        classificationConfidence: classification.classificationConfidence,
        isMultiPart: candidate.isMultiPart,
        parts: candidate.parts,
        parentQuestionId:
          candidate.isFollowUp || candidate.isClarification ? (parent?.id ?? null) : null,
        relatedQuestionId:
          candidate.isFollowUp || candidate.isClarification ? (parent?.id ?? null) : null,
      };

      this.context.addQuestion(question);
      this.current = question;
      produced.push(question);

      this.onLog('question.detected', {
        questionId: question.id,
        detectionConfidence: question.detectionConfidence,
        sessionId: this.getSessionId(),
        correlationId: this.getCorrelationId(),
      });
      this.emit({
        type: 'question.detected',
        questionId: question.id,
        timestamp: Date.now(),
        sessionId: this.getSessionId(),
        correlationId: this.getCorrelationId(),
        question,
      });

      this.onLog('question.classified', {
        questionId: question.id,
        classification: question.type,
        classificationConfidence: question.classificationConfidence,
        sessionId: this.getSessionId(),
        correlationId: this.getCorrelationId(),
      });
      this.emit({
        type: 'question.classified',
        questionId: question.id,
        timestamp: Date.now(),
        sessionId: this.getSessionId(),
        correlationId: this.getCorrelationId(),
        question,
      });
    }

    return produced;
  }

  /**
   * Simulation path: normalize + classify + emit without duplicate detection.
   * Always produces one question for a known interviewer prompt.
   */
  private processSimulatedUtterance(
    text: string,
    timestamp: number,
    options?: {
      simulationQuestionId?: string;
      expectedType?: QuestionType;
      isFollowUp?: boolean;
      parentQuestionId?: string | null;
    },
  ): DetectedQuestion[] {
    this.lastProcessedAt = Date.now();
    const { originalText, normalizedText } = this.normalizer.normalize(text);
    const hints = {
      isFollowUp: options?.isFollowUp ?? false,
      isClarification: false,
      isMultiPart: false,
    };
    const classified = this.classifier.classify(normalizedText, hints);
    const type = options?.expectedType ?? classified.type;
    const parentId =
      options?.parentQuestionId ??
      (hints.isFollowUp ? (this.context.getLastQuestion()?.id ?? null) : null);

    const question: DetectedQuestion = {
      id: this.createId(),
      text: normalizedText,
      originalText,
      normalizedText,
      type,
      status: 'classified',
      timestamp,
      sourceSegmentIds: ['simulation'],
      detectionConfidence: DETECTION_CONFIDENCE.DEFINITE_QUESTION,
      classificationConfidence: options?.expectedType
        ? Math.max(classified.classificationConfidence, 0.85)
        : classified.classificationConfidence,
      isMultiPart: false,
      parts: [],
      parentQuestionId: parentId,
      relatedQuestionId: parentId,
    };

    this.context.addQuestion(question);
    this.current = question;

    this.onLog('question.detected', {
      questionId: question.id,
      detectionConfidence: question.detectionConfidence,
      simulationQuestionId: options?.simulationQuestionId ?? null,
      source: 'simulation',
      sessionId: this.getSessionId(),
      correlationId: this.getCorrelationId(),
    });
    this.emit({
      type: 'question.detected',
      questionId: question.id,
      timestamp: Date.now(),
      sessionId: this.getSessionId(),
      correlationId: this.getCorrelationId(),
      question,
    });

    this.onLog('question.classified', {
      questionId: question.id,
      classification: question.type,
      classificationConfidence: question.classificationConfidence,
      simulationQuestionId: options?.simulationQuestionId ?? null,
      source: 'simulation',
      sessionId: this.getSessionId(),
      correlationId: this.getCorrelationId(),
    });
    this.emit({
      type: 'question.classified',
      questionId: question.id,
      timestamp: Date.now(),
      sessionId: this.getSessionId(),
      correlationId: this.getCorrelationId(),
      question,
    });

    return [question];
  }

  private emit(event: QuestionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
