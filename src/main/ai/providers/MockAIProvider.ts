import type { AIChunk, AIProviderStatus, AIRequest } from '../../../shared/ai/types';
import type { AIProvider } from '../../../core/ai/AIProvider';
import { AppError } from '../../../shared/errors';
import { getJavaInterviewDataset } from '../../../core/simulation/javaInterviewDataset';
import { matchJavaInterviewAnswer } from '../../../core/simulation/matchJavaInterviewAnswer';

export interface MockAIProviderOptions {
  model?: string;
  /** Delay between streamed chunks (ms). Default 30. */
  chunkDelayMs?: number;
}

/**
 * Deterministic streaming mock for tests and offline interview simulation.
 * Looks up Java interview dataset answers when the question matches.
 */
export class MockAIProvider implements AIProvider {
  private connected = false;
  private activeRequestId: string | null = null;
  private cancelled = new Set<string>();
  private readonly model: string;
  private readonly chunkDelayMs: number;

  constructor(options?: MockAIProviderOptions) {
    this.model = options?.model ?? 'mock-answer-v1';
    this.chunkDelayMs = options?.chunkDelayMs ?? 30;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.activeRequestId = null;
  }

  async cancel(requestId: string): Promise<void> {
    this.cancelled.add(requestId);
    if (this.activeRequestId === requestId) {
      this.activeRequestId = null;
    }
  }

  getStatus(): AIProviderStatus {
    return {
      provider: 'mock',
      connected: this.connected,
      model: this.model,
      activeRequestId: this.activeRequestId,
      lastErrorCode: null,
    };
  }

  async *generate(request: AIRequest): AsyncIterable<AIChunk> {
    if (!this.connected) {
      throw new AppError('PROVIDER', 'Mock AI provider is not connected');
    }
    this.activeRequestId = request.requestId;
    const answer = this.buildAnswer(request);
    const parts = answer.match(/.{1,18}/g) ?? [answer];
    let sequence = 0;
    for (const part of parts) {
      if (this.cancelled.has(request.requestId)) {
        this.activeRequestId = null;
        return;
      }
      await delay(this.chunkDelayMs);
      yield {
        requestId: request.requestId,
        sequence: sequence++,
        text: part,
        isFinal: false,
      };
    }
    yield {
      requestId: request.requestId,
      sequence: sequence++,
      text: '',
      isFinal: true,
    };
    this.activeRequestId = null;
  }

  private buildAnswer(request: AIRequest): string {
    const matched = matchJavaInterviewAnswer(
      request.question.text,
      getJavaInterviewDataset(),
    );
    if (matched) {
      return matched.answer;
    }

    const mode = request.responseMode;
    const question = request.question.text;
    if (mode === 'short') {
      return `Short answer for: ${question}`;
    }
    if (mode === 'detailed') {
      return `Detailed answer for: ${question}. Explanation: use the provided context. Example: apply the same pattern in a similar service. Trade-off: more detail increases response length.`;
    }
    return `Normal answer for: ${question}. Brief explanation with context awareness.`;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
