import type { SafeErrorPayload } from '../../shared/errors';
import type {
  AIPublicConfig,
  AIResponseMetadata,
  AIResponseState,
  AIResponseStatus,
  AIUsage,
  ResponseMode,
  AIProviderId,
} from '../../shared/ai/types';
import { DEFAULT_AI_PUBLIC_CONFIG } from '../../shared/ai/types';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';

export class AIResponseManager {
  private current: AIResponseState | null = null;
  private readonly history: AIResponseState[] = [];
  private readonly createId: IdGenerator;
  private maxHistory: number;

  constructor(options?: { idGenerator?: IdGenerator; maxHistory?: number }) {
    this.createId = options?.idGenerator ?? createDefaultIdGenerator();
    this.maxHistory = options?.maxHistory ?? DEFAULT_AI_PUBLIC_CONFIG.maxResponseHistory;
  }

  configure(config: Pick<AIPublicConfig, 'maxResponseHistory'>): void {
    this.maxHistory = config.maxResponseHistory;
    while (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  begin(input: {
    requestId: string;
    questionId: string;
    sessionId: string | null;
    correlationId: string | null;
    provider: AIProviderId;
    model: string;
    responseMode: ResponseMode;
  }): AIResponseState {
    const now = Date.now();
    this.current = {
      id: this.createId(),
      requestId: input.requestId,
      questionId: input.questionId,
      sessionId: input.sessionId,
      correlationId: input.correlationId,
      status: 'preparing',
      text: '',
      startedAt: now,
      firstTokenAt: null,
      completedAt: null,
      error: null,
      metadata: {
        model: input.model,
        provider: input.provider,
        responseMode: input.responseMode,
        usage: null,
        latencyMs: null,
        timeToFirstTokenMs: null,
        truncated: false,
      },
    };
    return this.clone(this.current);
  }

  markGenerating(): AIResponseState | null {
    if (!this.current) return null;
    this.current.status = 'generating';
    return this.clone(this.current);
  }

  appendChunk(text: string, at = Date.now()): AIResponseState | null {
    if (!this.current) return null;
    if (this.current.status !== 'generating' && this.current.status !== 'preparing') {
      return this.clone(this.current);
    }
    this.current.status = 'generating';
    this.current.text += text;
    if (this.current.firstTokenAt == null && text.length > 0) {
      this.current.firstTokenAt = at;
      if (this.current.startedAt != null) {
        this.current.metadata.timeToFirstTokenMs = at - this.current.startedAt;
      }
    }
    return this.clone(this.current);
  }

  complete(usage?: AIUsage | null, at = Date.now()): AIResponseState | null {
    if (!this.current) return null;
    this.current.status = 'completed';
    this.current.completedAt = at;
    this.current.metadata.usage = usage ?? null;
    if (this.current.startedAt != null) {
      this.current.metadata.latencyMs = at - this.current.startedAt;
    }
    this.pushHistory(this.current);
    return this.clone(this.current);
  }

  cancel(at = Date.now()): AIResponseState | null {
    if (!this.current) return null;
    if (this.current.status === 'completed' || this.current.status === 'cancelled') {
      return this.clone(this.current);
    }
    this.current.status = 'cancelled';
    this.current.completedAt = at;
    if (this.current.startedAt != null) {
      this.current.metadata.latencyMs = at - this.current.startedAt;
    }
    this.pushHistory(this.current);
    return this.clone(this.current);
  }

  fail(error: SafeErrorPayload, at = Date.now()): AIResponseState | null {
    if (!this.current) return null;
    this.current.status = 'error';
    this.current.error = error;
    this.current.completedAt = at;
    if (this.current.startedAt != null) {
      this.current.metadata.latencyMs = at - this.current.startedAt;
    }
    this.pushHistory(this.current);
    return this.clone(this.current);
  }

  getCurrent(): AIResponseState | null {
    return this.current ? this.clone(this.current) : null;
  }

  getStatus(): AIResponseStatus {
    return this.current?.status ?? 'idle';
  }

  getRecent(limit = 10): AIResponseState[] {
    return this.history.slice(-limit).map((item) => this.clone(item));
  }

  clear(): void {
    this.current = null;
    this.history.length = 0;
  }

  patchMetadata(patch: Partial<AIResponseMetadata>): void {
    if (!this.current) return;
    this.current.metadata = { ...this.current.metadata, ...patch };
  }

  private pushHistory(state: AIResponseState): void {
    this.history.push(this.clone(state));
    while (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  private clone(state: AIResponseState): AIResponseState {
    return structuredClone(state);
  }
}
