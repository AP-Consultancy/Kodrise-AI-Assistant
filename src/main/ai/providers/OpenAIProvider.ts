import OpenAI from 'openai';
import type { AIChunk, AIProviderStatus, AIRequest } from '../../../shared/ai/types';
import type { AIProvider } from '../../../core/ai/AIProvider';
import {
  AppError,
  AuthenticationError,
  NetworkError,
} from '../../../shared/errors';

export interface OpenAIProviderOptions {
  model: string;
  getApiKey: () => Promise<string | null>;
}

export type OpenAiFailureCategory =
  | 'missing_credential'
  | 'authentication'
  | 'quota_billing'
  | 'rate_limit'
  | 'invalid_request'
  | 'network'
  | 'provider'
  | 'cancelled';

/**
 * Classify OpenAI SDK / HTTP failures without exposing secrets.
 */
export function classifyOpenAiFailure(error: unknown): {
  category: OpenAiFailureCategory;
  status?: number;
  providerCode?: string;
  safeMessage: string;
} {
  if (error instanceof AppError) {
    if (error.code === 'CONFIGURATION') {
      return { category: 'missing_credential', safeMessage: error.message };
    }
    if (error.code === 'AUTHENTICATION') {
      return { category: 'authentication', safeMessage: error.message };
    }
    if (error.code === 'NETWORK') {
      return { category: 'network', safeMessage: error.message };
    }
  }

  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: number }).status)
      : undefined;
  const providerCode =
    typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : undefined;
  const rawMessage = error instanceof Error ? error.message : 'OpenAI provider request failed';
  const lower = `${rawMessage} ${providerCode ?? ''}`.toLowerCase();

  if (status === 401 || status === 403 || /invalid.?api.?key|incorrect.?api.?key/.test(lower)) {
    return {
      category: 'authentication',
      status,
      providerCode,
      safeMessage: 'OpenAI authentication failed',
    };
  }
  if (
    providerCode === 'insufficient_quota' ||
    /insufficient.?quota|billing|exceeded your current quota|payment/.test(lower)
  ) {
    return {
      category: 'quota_billing',
      status,
      providerCode,
      safeMessage: 'OpenAI quota or billing limit reached',
    };
  }
  if (status === 429 || providerCode === 'rate_limit_exceeded' || /rate.?limit/.test(lower)) {
    return {
      category: 'rate_limit',
      status,
      providerCode,
      safeMessage: 'OpenAI rate limit exceeded',
    };
  }
  if (status === 400 || providerCode === 'invalid_request_error' || /invalid.?request/.test(lower)) {
    return {
      category: 'invalid_request',
      status,
      providerCode,
      safeMessage: 'OpenAI rejected the request configuration',
    };
  }
  if (
    providerCode === 'ENOTFOUND' ||
    providerCode === 'ECONNRESET' ||
    providerCode === 'ETIMEDOUT' ||
    /network|fetch failed|socket/.test(lower)
  ) {
    return {
      category: 'network',
      status,
      providerCode,
      safeMessage: 'OpenAI network request failed',
    };
  }

  return {
    category: 'provider',
    status,
    providerCode,
    safeMessage: sanitizeProviderMessage(rawMessage),
  };
}

function sanitizeProviderMessage(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 180);
}

/**
 * OpenAI Chat Completions streaming adapter.
 * Lives in main process only — never imported by renderer.
 */
export class OpenAIProvider implements AIProvider {
  private client: OpenAI | null = null;
  private connected = false;
  private activeRequestId: string | null = null;
  private abortControllers = new Map<string, AbortController>();
  private lastErrorCode: string | null = null;
  private lastFailureCategory: OpenAiFailureCategory | null = null;
  private readonly model: string;
  private readonly getApiKey: () => Promise<string | null>;

  constructor(options: OpenAIProviderOptions) {
    this.model = options.model;
    this.getApiKey = options.getApiKey;
  }

  async connect(): Promise<void> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      this.lastErrorCode = 'CONFIGURATION';
      this.lastFailureCategory = 'missing_credential';
      throw new AppError('CONFIGURATION', 'OpenAI API key is not configured');
    }
    this.client = new OpenAI({ apiKey });
    this.connected = true;
    this.lastErrorCode = null;
    this.lastFailureCategory = null;
  }

  async disconnect(): Promise<void> {
    for (const [requestId, controller] of this.abortControllers) {
      controller.abort();
      this.abortControllers.delete(requestId);
    }
    this.client = null;
    this.connected = false;
    this.activeRequestId = null;
  }

  async cancel(requestId: string): Promise<void> {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(requestId);
    }
    if (this.activeRequestId === requestId) {
      this.activeRequestId = null;
    }
  }

  getStatus(): AIProviderStatus {
    return {
      provider: 'openai',
      connected: this.connected,
      model: this.model,
      activeRequestId: this.activeRequestId,
      lastErrorCode: this.lastErrorCode,
    };
  }

  getLastFailureCategory(): OpenAiFailureCategory | null {
    return this.lastFailureCategory;
  }

  async *generate(request: AIRequest): AsyncIterable<AIChunk> {
    if (!this.connected || !this.client) {
      throw new AppError('PROVIDER', 'OpenAI provider is not connected');
    }

    const controller = new AbortController();
    this.abortControllers.set(request.requestId, controller);
    this.activeRequestId = request.requestId;

    let sequence = 0;
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: request.metadata.model || this.model,
          temperature: request.metadata.temperature,
          max_tokens: request.metadata.maxOutputTokens,
          stream: true,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        },
        { signal: controller.signal },
      );

      for await (const part of stream) {
        if (controller.signal.aborted) {
          break;
        }
        const delta = part.choices[0]?.delta?.content;
        if (!delta) {
          continue;
        }
        yield {
          requestId: request.requestId,
          sequence: sequence++,
          text: delta,
          isFinal: false,
        };
      }

      yield {
        requestId: request.requestId,
        sequence: sequence++,
        text: '',
        isFinal: true,
      };
      this.lastErrorCode = null;
      this.lastFailureCategory = null;
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        this.lastFailureCategory = 'cancelled';
        return;
      }
      throw this.mapError(error);
    } finally {
      this.abortControllers.delete(request.requestId);
      if (this.activeRequestId === request.requestId) {
        this.activeRequestId = null;
      }
    }
  }

  private mapError(error: unknown): AppError {
    if (error instanceof AppError) {
      this.lastErrorCode = error.code;
      this.lastFailureCategory = classifyOpenAiFailure(error).category;
      return error;
    }

    const classified = classifyOpenAiFailure(error);
    this.lastFailureCategory = classified.category;

    if (classified.category === 'authentication') {
      this.lastErrorCode = 'AUTHENTICATION';
      return new AuthenticationError(classified.safeMessage);
    }
    if (classified.category === 'network') {
      this.lastErrorCode = 'NETWORK';
      return new NetworkError(classified.safeMessage);
    }
    if (classified.category === 'quota_billing' || classified.category === 'rate_limit') {
      this.lastErrorCode = 'PROVIDER';
      return new AppError('PROVIDER', classified.safeMessage, {
        details: {
          category: classified.category,
          status: classified.status,
          providerCode: classified.providerCode,
        },
      });
    }
    if (classified.category === 'invalid_request') {
      this.lastErrorCode = 'VALIDATION';
      return new AppError('VALIDATION', classified.safeMessage, {
        details: {
          category: classified.category,
          status: classified.status,
          providerCode: classified.providerCode,
        },
      });
    }

    this.lastErrorCode = 'PROVIDER';
    return new AppError('PROVIDER', classified.safeMessage, {
      details: {
        category: classified.category,
        status: classified.status,
        providerCode: classified.providerCode,
      },
    });
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name?: string }).name) : '';
  return name === 'AbortError' || name === 'APIUserAbortError';
}
