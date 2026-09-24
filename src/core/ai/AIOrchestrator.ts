import type { ContextSnapshot } from '../../shared/context/types';
import type { DetectedQuestion } from '../../shared/questions/types';
import type {
  AIConfigStatus,
  AIEvent,
  AIOrchestratorStatus,
  AIPublicConfig,
  AIRequest,
  AIResponseState,
} from '../../shared/ai/types';
import { DEFAULT_AI_PUBLIC_CONFIG } from '../../shared/ai/types';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';
import { toSafeErrorPayload, ValidationError, AppError } from '../../shared/errors';
import { PromptBuilder } from '../prompts/PromptBuilder';
import type { AIProvider } from './AIProvider';
import { AIResponseManager } from './AIResponseManager';

export type AIListener = (event: AIEvent) => void;

export interface AIOrchestratorOptions {
  idGenerator?: IdGenerator;
  sessionId?: () => string | null;
  correlationId?: () => string | null;
  getConfig?: () => AIPublicConfig;
  isConfigured?: () => Promise<boolean>;
  createProvider?: (config: AIPublicConfig) => AIProvider;
  getContextForQuestion?: (questionId: string) => ContextSnapshot | null;
  getQuestion?: (questionId: string) => DetectedQuestion | null;
  onLog?: (event: string, meta: Record<string, unknown>) => void;
}

/**
 * Coordinates prompt build, provider streaming, response state, and cancellation.
 * Does not import vendor SDKs.
 */
export class AIOrchestrator {
  private enabled = true;
  private provider: AIProvider | null = null;
  private activeRequestId: string | null = null;
  private generationPromise: Promise<void> | null = null;
  private readonly generatedQuestionIds = new Set<string>();
  private readonly responses: AIResponseManager;
  private readonly promptBuilder = new PromptBuilder();
  private readonly listeners = new Set<AIListener>();
  private readonly createId: IdGenerator;
  private readonly getSessionId: () => string | null;
  private readonly getCorrelationId: () => string | null;
  private readonly getConfig: () => AIPublicConfig;
  private readonly isConfigured: () => Promise<boolean>;
  private readonly createProvider: ((config: AIPublicConfig) => AIProvider) | null;
  private readonly getContextForQuestion: (questionId: string) => ContextSnapshot | null;
  private readonly getQuestion: (questionId: string) => DetectedQuestion | null;
  private readonly onLog: (event: string, meta: Record<string, unknown>) => void;
  private lastErrorCode: string | null = null;

  constructor(options: AIOrchestratorOptions = {}) {
    this.createId = options.idGenerator ?? createDefaultIdGenerator();
    this.responses = new AIResponseManager({
      idGenerator: this.createId,
      maxHistory: DEFAULT_AI_PUBLIC_CONFIG.maxResponseHistory,
    });
    this.getSessionId = options.sessionId ?? (() => null);
    this.getCorrelationId = options.correlationId ?? (() => null);
    this.getConfig = options.getConfig ?? (() => structuredClone(DEFAULT_AI_PUBLIC_CONFIG));
    this.isConfigured = options.isConfigured ?? (async () => false);
    this.createProvider = options.createProvider ?? null;
    this.getContextForQuestion = options.getContextForQuestion ?? (() => null);
    this.getQuestion = options.getQuestion ?? (() => null);
    this.onLog = options.onLog ?? (() => undefined);
  }

  subscribe(listener: AIListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async ensureProvider(): Promise<AIProvider> {
    const config = this.getConfig();
    this.responses.configure(config);
    if (!this.createProvider) {
      throw new AppError('CONFIGURATION', 'AI provider factory is not configured');
    }
    if (this.provider) {
      await this.provider.disconnect();
    }
    this.provider = this.createProvider(config);
    await this.provider.connect();
    return this.provider;
  }

  /**
   * Auto-generate path — respects autoGenerate, confidence, and duplicate guards.
   */
  async maybeAutoGenerate(input: {
    question: DetectedQuestion;
    context: ContextSnapshot;
  }): Promise<AIResponseState | null> {
    const config = this.getConfig();
    if (!this.enabled || !config.autoGenerate) {
      return null;
    }
    if (input.question.classificationConfidence < config.minClassificationConfidence) {
      return null;
    }
    if (this.generatedQuestionIds.has(input.question.id)) {
      return null;
    }
    if (this.activeRequestId) {
      return null;
    }
    return this.generate({
      question: input.question,
      context: input.context,
      force: false,
    });
  }

  async generateForQuestionId(
    questionId: string,
    options?: { force?: boolean },
  ): Promise<AIResponseState> {
    const question = this.getQuestion(questionId);
    if (!question) {
      throw new ValidationError('Question not found', { questionId });
    }
    const context = this.getContextForQuestion(questionId);
    if (!context) {
      throw new ValidationError('Context snapshot not available for question', { questionId });
    }
    return this.generate({
      question,
      context,
      force: options?.force ?? true,
    });
  }

  async generate(input: {
    question: DetectedQuestion;
    context: ContextSnapshot;
    force?: boolean;
  }): Promise<AIResponseState> {
    if (!this.enabled) {
      throw new AppError('SESSION', 'AI orchestration is disabled for this session');
    }
    if (this.activeRequestId) {
      throw new AppError('PROVIDER', 'Another AI generation is already in progress');
    }
    if (!input.force && this.generatedQuestionIds.has(input.question.id)) {
      throw new AppError('VALIDATION', 'Answer already generated for this question');
    }

    const configured = await this.isConfigured();
    const config = this.getConfig();
    if (config.provider !== 'mock' && !configured) {
      throw new AppError('CONFIGURATION', 'AI provider credentials are not configured');
    }

    const requestId = this.createId();
    this.activeRequestId = requestId;
    this.responses.configure(config);

    const messages = this.promptBuilder.build({
      question: input.question,
      context: input.context,
      responseMode: config.responseMode,
    });

    const request: AIRequest = {
      requestId,
      sessionId: this.getSessionId(),
      correlationId: this.getCorrelationId(),
      question: structuredClone(input.question),
      context: structuredClone(input.context),
      responseMode: config.responseMode,
      messages,
      metadata: {
        model: config.model,
        temperature: config.temperature,
        maxOutputTokens: config.maxOutputTokens,
        responseMode: config.responseMode,
        provider: config.provider,
        contextId: input.context.id,
        questionId: input.question.id,
      },
    };

    const response = this.responses.begin({
      requestId,
      questionId: input.question.id,
      sessionId: request.sessionId,
      correlationId: request.correlationId,
      provider: config.provider,
      model: config.model,
      responseMode: config.responseMode,
    });

    this.onLog('ai.request.started', {
      requestId,
      responseId: response.id,
      questionId: input.question.id,
      sessionId: request.sessionId,
      correlationId: request.correlationId,
      provider: config.provider,
      model: config.model,
    });
    this.emit({
      type: 'ai.request.started',
      requestId,
      responseId: response.id,
      questionId: input.question.id,
      sessionId: request.sessionId,
      correlationId: request.correlationId,
      timestamp: Date.now(),
      status: 'preparing',
    });

    this.generationPromise = this.runGeneration(request, response.id);
    await this.generationPromise;
    this.generationPromise = null;

    const finalState = this.responses.getCurrent();
    if (!finalState) {
      throw new AppError('INTERNAL', 'AI response state missing after generation');
    }
    return finalState;
  }

  async cancel(requestId?: string): Promise<AIResponseState | null> {
    const active = this.activeRequestId;
    if (!active) {
      return this.responses.getCurrent();
    }
    if (requestId && requestId !== active) {
      throw new ValidationError('Request id does not match active generation');
    }
    if (this.provider) {
      await this.provider.cancel(active);
    }
    const cancelled = this.responses.cancel();
    this.activeRequestId = null;
    this.lastErrorCode = null;
    if (cancelled) {
      this.onLog('ai.response.cancelled', {
        requestId: cancelled.requestId,
        responseId: cancelled.id,
        questionId: cancelled.questionId,
        sessionId: cancelled.sessionId,
        correlationId: cancelled.correlationId,
      });
      this.emit({
        type: 'ai.response.cancelled',
        requestId: cancelled.requestId,
        responseId: cancelled.id,
        questionId: cancelled.questionId,
        sessionId: cancelled.sessionId,
        correlationId: cancelled.correlationId,
        timestamp: Date.now(),
        status: 'cancelled',
        metadata: cancelled.metadata,
      });
    }
    return cancelled;
  }

  getCurrentResponse(): AIResponseState | null {
    return this.responses.getCurrent();
  }

  getRecentResponses(limit?: number): AIResponseState[] {
    return this.responses.getRecent(limit);
  }

  clearResponses(): void {
    this.responses.clear();
    this.generatedQuestionIds.clear();
  }

  resetForSessionStop(): void {
    void this.cancel().catch(() => undefined);
    this.setEnabled(false);
    this.clearResponses();
    void this.provider?.disconnect();
    this.provider = null;
  }

  async getConfigStatus(): Promise<AIConfigStatus> {
    const config = this.getConfig();
    const configured =
      config.provider === 'mock' ? true : await this.isConfigured();
    return {
      provider: config.provider,
      model: config.model,
      responseMode: config.responseMode,
      autoGenerate: config.autoGenerate,
      configured,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
    };
  }

  async getStatus(): Promise<AIOrchestratorStatus> {
    const config = this.getConfig();
    const configured =
      config.provider === 'mock' ? true : await this.isConfigured();
    const current = this.responses.getCurrent();
    return {
      enabled: this.enabled,
      provider: config.provider,
      model: config.model,
      autoGenerate: config.autoGenerate,
      configured,
      activeRequestId: this.activeRequestId,
      currentResponseId: current?.id ?? null,
      responseStatus: current?.status ?? 'idle',
      lastLatencyMs: current?.metadata.latencyMs ?? null,
      lastErrorCode: this.lastErrorCode,
    };
  }

  private async runGeneration(request: AIRequest, responseId: string): Promise<void> {
    try {
      const provider = await this.ensureProvider();
      this.responses.markGenerating();
      this.emit({
        type: 'ai.response.started',
        requestId: request.requestId,
        responseId,
        questionId: request.question.id,
        sessionId: request.sessionId,
        correlationId: request.correlationId,
        timestamp: Date.now(),
        status: 'generating',
      });

      let lastSequence = -1;
      for await (const chunk of provider.generate(request)) {
        if (this.activeRequestId !== request.requestId) {
          break;
        }
        if (chunk.sequence <= lastSequence) {
          continue;
        }
        lastSequence = chunk.sequence;
        if (chunk.text) {
          this.responses.appendChunk(chunk.text);
          this.emit({
            type: 'ai.response.chunk',
            requestId: request.requestId,
            responseId,
            questionId: request.question.id,
            sessionId: request.sessionId,
            correlationId: request.correlationId,
            timestamp: Date.now(),
            sequence: chunk.sequence,
            textDelta: chunk.text,
            status: 'generating',
          });
        }
      }

      if (this.responses.getStatus() === 'cancelled') {
        return;
      }

      const completed = this.responses.complete();
      this.generatedQuestionIds.add(request.question.id);
      this.activeRequestId = null;
      this.lastErrorCode = null;
      if (completed) {
        this.onLog('ai.response.completed', {
          requestId: completed.requestId,
          responseId: completed.id,
          questionId: completed.questionId,
          sessionId: completed.sessionId,
          correlationId: completed.correlationId,
          latencyMs: completed.metadata.latencyMs,
          timeToFirstTokenMs: completed.metadata.timeToFirstTokenMs,
          characterCount: completed.text.length,
        });
        this.emit({
          type: 'ai.response.completed',
          requestId: completed.requestId,
          responseId: completed.id,
          questionId: completed.questionId,
          sessionId: completed.sessionId,
          correlationId: completed.correlationId,
          timestamp: Date.now(),
          status: 'completed',
          metadata: completed.metadata,
        });
      }
    } catch (error) {
      if (this.responses.getStatus() === 'cancelled') {
        this.activeRequestId = null;
        return;
      }
      const config = this.getConfig();
      const configured =
        config.provider === 'mock' ? true : await this.isConfigured().catch(() => false);
      const safe = toSafeErrorPayload(error);
      this.lastErrorCode = safe.code;
      const failed = this.responses.fail(safe);
      this.activeRequestId = null;
      this.onLog('ai.response.error', {
        requestId: request.requestId,
        responseId,
        questionId: request.question.id,
        sessionId: request.sessionId,
        correlationId: request.correlationId,
        code: safe.code,
        message: safe.message,
        category:
          error instanceof AppError && error.details && typeof error.details.category === 'string'
            ? error.details.category
            : undefined,
        provider: request.metadata.provider,
        model: request.metadata.model,
        credentialConfigured: configured,
      });
      this.emit({
        type: 'ai.response.error',
        requestId: request.requestId,
        responseId,
        questionId: request.question.id,
        sessionId: request.sessionId,
        correlationId: request.correlationId,
        timestamp: Date.now(),
        status: 'error',
        error: safe,
      });
      if (failed) {
        return;
      }
      throw error;
    }
  }

  private emit(event: AIEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
