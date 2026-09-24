import type { DetectedQuestion } from '../../shared/questions/types';
import type { TranscriptSegment } from '../../shared/transcription/types';
import type {
  ContextBudget,
  ContextEngineStatus,
  ContextEvent,
  ContextPublicConfig,
  ContextSnapshot,
  ProjectContext,
  UserContext,
} from '../../shared/context/types';
import { DEFAULT_CONTEXT_BUDGET, DEFAULT_CONTEXT_PUBLIC_CONFIG } from '../../shared/context/types';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';
import { ContextBuilder } from './ContextBuilder';

export type ContextListener = (event: ContextEvent) => void;

export interface ContextEngineOptions {
  idGenerator?: IdGenerator;
  sessionId?: () => string | null;
  correlationId?: () => string | null;
  getConfig?: () => ContextPublicConfig;
  onLog?: (event: string, meta: Record<string, unknown>) => void;
}

/**
 * Deterministic context engine — no network, LLM, or embeddings.
 */
export class ContextEngine {
  private enabled = true;
  private readonly builder: ContextBuilder;
  private readonly snapshots: ContextSnapshot[] = [];
  private current: ContextSnapshot | null = null;
  private readonly listeners = new Set<ContextListener>();
  private readonly getSessionId: () => string | null;
  private readonly getCorrelationId: () => string | null;
  private readonly getConfig: () => ContextPublicConfig;
  private readonly onLog: (event: string, meta: Record<string, unknown>) => void;

  constructor(options: ContextEngineOptions = {}) {
    this.builder = new ContextBuilder({
      idGenerator: options.idGenerator ?? createDefaultIdGenerator(),
    });
    this.getSessionId = options.sessionId ?? (() => null);
    this.getCorrelationId = options.correlationId ?? (() => null);
    this.getConfig = options.getConfig ?? (() => structuredClone(DEFAULT_CONTEXT_PUBLIC_CONFIG));
    this.onLog = options.onLog ?? (() => undefined);
  }

  subscribe(listener: ContextListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  buildForQuestion(input: {
    question: DetectedQuestion;
    transcriptSegments: TranscriptSegment[];
    questionHistory: DetectedQuestion[];
    visualContext?: import('../../shared/visual-context/types').VisualContextSnapshot | null;
    interviewDocuments?: import('../../shared/context/types').InterviewDocumentContext | null;
  }): ContextSnapshot | null {
    if (!this.enabled) {
      return null;
    }

    try {
      const config = this.getConfig();
      const budget: ContextBudget = { ...DEFAULT_CONTEXT_BUDGET, ...config.budget };
      const snapshot = this.builder.build({
        currentQuestion: input.question,
        transcriptSegments: input.transcriptSegments,
        questionHistory: input.questionHistory,
        userContext: config.userContext,
        projectContext: config.projectContext,
        visualContext: input.visualContext ?? null,
        interviewDocuments: input.interviewDocuments ?? null,
        sessionId: this.getSessionId(),
        correlationId: this.getCorrelationId(),
        budget,
      });

      this.current = snapshot;
      this.snapshots.push(snapshot);
      while (this.snapshots.length > budget.maxRecentSnapshots) {
        this.snapshots.shift();
      }

      this.onLog('context.created', {
        contextId: snapshot.id,
        questionId: snapshot.questionId,
        sessionId: snapshot.sessionId,
        correlationId: snapshot.correlationId,
        truncated: snapshot.metadata.truncated,
        characterCount: snapshot.metadata.characterCount,
      });
      this.emit({
        type: 'context.created',
        contextId: snapshot.id,
        questionId: snapshot.questionId,
        sessionId: snapshot.sessionId,
        correlationId: snapshot.correlationId,
        timestamp: snapshot.createdAt,
        metadata: {
          truncated: snapshot.metadata.truncated,
          characterCount: snapshot.metadata.characterCount,
          omittedTranscriptSegments: snapshot.metadata.omittedTranscriptSegments,
          omittedQuestions: snapshot.metadata.omittedQuestions,
        },
      });

      return structuredClone(snapshot);
    } catch (error) {
      this.onLog('context.failed', {
        questionId: input.question.id,
        message: error instanceof Error ? error.message : 'context_build_failed',
      });
      this.emit({
        type: 'context.failed',
        contextId: 'none',
        questionId: input.question.id,
        sessionId: this.getSessionId(),
        correlationId: this.getCorrelationId(),
        timestamp: Date.now(),
      });
      return null;
    }
  }

  getCurrent(): ContextSnapshot | null {
    return this.current ? structuredClone(this.current) : null;
  }

  getRecent(limit = 10): ContextSnapshot[] {
    return this.snapshots.slice(-limit).map((snapshot) => structuredClone(snapshot));
  }

  clear(): void {
    this.snapshots.length = 0;
    this.current = null;
    this.onLog('context.truncated', {
      sessionId: this.getSessionId(),
      correlationId: this.getCorrelationId(),
    });
    this.emit({
      type: 'context.truncated',
      contextId: 'none',
      questionId: 'none',
      sessionId: this.getSessionId(),
      correlationId: this.getCorrelationId(),
      timestamp: Date.now(),
    });
  }

  resetForSessionStop(): void {
    this.setEnabled(false);
    this.clear();
  }

  getStatus(): ContextEngineStatus {
    const config = this.getConfig();
    return {
      enabled: this.enabled,
      snapshotCount: this.snapshots.length,
      currentContextId: this.current?.id ?? null,
      lastCreatedAt: this.current?.createdAt ?? null,
      userContextConfigured: this.isConfigured(config.userContext),
      projectContextConfigured: this.isConfigured(config.projectContext),
    };
  }

  private isConfigured(value: UserContext | ProjectContext): boolean {
    return Object.values(value).some((entry) => {
      if (Array.isArray(entry)) return entry.length > 0;
      if (typeof entry === 'object' && entry) return Object.keys(entry).length > 0;
      return Boolean(entry);
    });
  }

  private emit(event: ContextEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
