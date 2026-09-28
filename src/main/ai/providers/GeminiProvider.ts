import { GoogleGenAI } from '@google/genai';
import type {
  AIChunk,
  AIProviderCapabilities,
  AIProviderStatus,
  AIRequest,
} from '../../../shared/ai/types';
import { DEFAULT_GEMINI_CAPABILITIES } from '../../../shared/ai/types';
import type { AIProvider } from '../../../core/ai/AIProvider';
import {
  AppError,
} from '../../../shared/errors';
import { logger } from '../../services/logging';

export interface GeminiProviderOptions {
  model: string;
  getApiKey: () => Promise<string | null>;
}

export type GeminiFailureCategory =
  | 'missing_credential'
  | 'authentication'
  | 'quota_billing'
  | 'rate_limit'
  | 'invalid_request'
  | 'model_unavailable'
  | 'network'
  | 'timeout'
  | 'provider'
  | 'unsupported_capability'
  | 'cancelled';

/** Stable diagnostic codes for logs / connection tests (never includes secrets). */
export type GeminiDiagnosticCode =
  | 'INVALID_API_KEY'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'MODEL_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface GeminiFailureClassification {
  category: GeminiFailureCategory;
  diagnosticCode: GeminiDiagnosticCode;
  status?: number;
  providerCode?: string;
  errorType: string;
  safeMessage: string;
}

export function diagnosticCodeFromCategory(
  category: GeminiFailureCategory,
  status?: number,
): GeminiDiagnosticCode {
  switch (category) {
    case 'missing_credential':
      return 'INVALID_API_KEY';
    case 'authentication':
      if (status === 403) return 'FORBIDDEN';
      if (status === 401) return 'UNAUTHORIZED';
      return 'INVALID_API_KEY';
    case 'quota_billing':
      return 'QUOTA_EXCEEDED';
    case 'rate_limit':
      return 'RATE_LIMITED';
    case 'model_unavailable':
      return 'MODEL_UNAVAILABLE';
    case 'invalid_request':
    case 'unsupported_capability':
      return 'INVALID_REQUEST';
    case 'network':
      return 'NETWORK_ERROR';
    case 'timeout':
      return 'TIMEOUT';
    case 'cancelled':
      return 'CANCELLED';
    default:
      return 'UNKNOWN';
  }
}

function geminiErrorType(error: unknown): string {
  if (error instanceof AppError) return error.name || 'AppError';
  if (error instanceof Error) return error.name || 'Error';
  if (error && typeof error === 'object' && 'name' in error) {
    return String((error as { name?: unknown }).name ?? 'Object');
  }
  return typeof error;
}

/**
 * Classify Gemini SDK / HTTP failures without exposing secrets.
 */
export function classifyGeminiFailure(error: unknown): GeminiFailureClassification {
  if (error instanceof AppError) {
    const status =
      error.details && typeof error.details.status === 'number'
        ? error.details.status
        : undefined;
    const existingDiagnostic =
      error.details && typeof error.details.diagnosticCode === 'string'
        ? (error.details.diagnosticCode as GeminiDiagnosticCode)
        : undefined;
    if (error.code === 'CONFIGURATION') {
      return {
        category: 'missing_credential',
        diagnosticCode: existingDiagnostic ?? 'INVALID_API_KEY',
        status,
        errorType: geminiErrorType(error),
        safeMessage: error.message,
      };
    }
    if (error.code === 'AUTHENTICATION') {
      const category: GeminiFailureCategory = 'authentication';
      return {
        category,
        diagnosticCode:
          existingDiagnostic ?? diagnosticCodeFromCategory(category, status),
        status,
        errorType: geminiErrorType(error),
        safeMessage: error.message,
      };
    }
    if (error.code === 'NETWORK') {
      const category: GeminiFailureCategory =
        /timeout/i.test(error.message) ? 'timeout' : 'network';
      return {
        category,
        diagnosticCode:
          existingDiagnostic ?? diagnosticCodeFromCategory(category, status),
        status,
        errorType: geminiErrorType(error),
        safeMessage: error.message,
      };
    }
    if (error.details && error.details.category === 'unsupported_capability') {
      return {
        category: 'unsupported_capability',
        diagnosticCode: existingDiagnostic ?? 'INVALID_REQUEST',
        status,
        errorType: geminiErrorType(error),
        safeMessage: error.message,
      };
    }
    if (error.details && typeof error.details.category === 'string') {
      const category = error.details.category as GeminiFailureCategory;
      return {
        category,
        diagnosticCode:
          existingDiagnostic ?? diagnosticCodeFromCategory(category, status),
        status,
        providerCode:
          typeof error.details.providerCode === 'string'
            ? error.details.providerCode
            : undefined,
        errorType: geminiErrorType(error),
        safeMessage: error.message,
      };
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
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'object' &&
          error &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
        ? String((error as { message: string }).message)
        : 'Gemini provider request failed';
  const lower = `${rawMessage} ${providerCode ?? ''}`.toLowerCase();
  const errorType = geminiErrorType(error);

  if (
    /api.?key.?not.?valid|invalid.?api.?key|api_key_invalid|expired.?api.?key/.test(lower) ||
    providerCode === 'API_KEY_INVALID'
  ) {
    return {
      category: 'authentication',
      diagnosticCode: 'INVALID_API_KEY',
      status,
      providerCode,
      errorType,
      safeMessage: 'Gemini API key is invalid.',
    };
  }
  if (status === 403 || /permission.?denied|forbidden/.test(lower)) {
    return {
      category: 'authentication',
      diagnosticCode: 'FORBIDDEN',
      status,
      providerCode,
      errorType,
      safeMessage: 'Gemini request was forbidden for this API key.',
    };
  }
  if (status === 401 || /unauthenticated|unauthorized/.test(lower)) {
    return {
      category: 'authentication',
      diagnosticCode: 'UNAUTHORIZED',
      status,
      providerCode,
      errorType,
      safeMessage: 'Gemini authentication failed.',
    };
  }
  if (
    status === 429 &&
    (/quota|resource.?exhausted|billing|payment/.test(lower) ||
      providerCode === 'RESOURCE_EXHAUSTED')
  ) {
    return {
      category: 'quota_billing',
      diagnosticCode: 'QUOTA_EXCEEDED',
      status,
      providerCode,
      errorType,
      safeMessage: 'Gemini quota has been exceeded.',
    };
  }
  if (status === 429 || /rate.?limit|too.?many.?requests/.test(lower)) {
    return {
      category: 'rate_limit',
      diagnosticCode: 'RATE_LIMITED',
      status,
      providerCode,
      errorType,
      safeMessage: 'Gemini rate limit exceeded. Try again shortly.',
    };
  }
  if (
    status === 404 ||
    /models?\/[\w.-]+.*(not.?found|unavailable)|model.*(not.?found|unavailable|does.?not.?exist)/.test(
      lower,
    )
  ) {
    return {
      category: 'model_unavailable',
      diagnosticCode: 'MODEL_UNAVAILABLE',
      status,
      providerCode,
      errorType,
      safeMessage:
        'Gemini model is unavailable. Update the Gemini Model setting (try gemini-3.8-flash).',
    };
  }
  if (status === 400 || /invalid.?argument|invalid.?request|bad.?request/.test(lower)) {
    return {
      category: 'invalid_request',
      diagnosticCode: 'INVALID_REQUEST',
      status,
      providerCode,
      errorType,
      safeMessage: 'Gemini rejected the request configuration.',
    };
  }
  if (/timeout|etimedout|deadline/.test(lower)) {
    return {
      category: 'timeout',
      diagnosticCode: 'TIMEOUT',
      status,
      providerCode,
      errorType,
      safeMessage: 'Gemini request timed out.',
    };
  }
  if (
    providerCode === 'ENOTFOUND' ||
    providerCode === 'ECONNRESET' ||
    providerCode === 'ETIMEDOUT' ||
    /network|fetch failed|socket|econnrefused|dns|enotfound/.test(lower)
  ) {
    return {
      category: 'network',
      diagnosticCode: 'NETWORK_ERROR',
      status,
      providerCode,
      errorType,
      safeMessage: 'Unable to connect to Gemini.',
    };
  }
  if (status != null && status >= 500) {
    return {
      category: 'provider',
      diagnosticCode: 'UNKNOWN',
      status,
      providerCode,
      errorType,
      safeMessage: 'Gemini is temporarily unavailable.',
    };
  }

  return {
    category: 'provider',
    diagnosticCode: 'UNKNOWN',
    status,
    providerCode,
    errorType,
    safeMessage: sanitizeProviderMessage(rawMessage) || 'Gemini is temporarily unavailable.',
  };
}

function sanitizeProviderMessage(message: string): string {
  return message
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/key[=:]\s*\S+/gi, 'key=[redacted]')
    .slice(0, 180);
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error ? String((error as { name?: string }).name) : '';
  return name === 'AbortError' || name === 'APIUserAbortError';
}

/**
 * Google Gemini streaming adapter via official `@google/genai` SDK.
 * Lives in main process only — never imported by renderer.
 */
export class GeminiProvider implements AIProvider {
  private client: GoogleGenAI | null = null;
  private connected = false;
  private activeRequestId: string | null = null;
  private abortControllers = new Map<string, AbortController>();
  private lastErrorCode: string | null = null;
  private lastFailureCategory: GeminiFailureCategory | null = null;
  private lastDiagnosticCode: GeminiDiagnosticCode | null = null;
  private readonly model: string;
  private readonly getApiKey: () => Promise<string | null>;

  constructor(options: GeminiProviderOptions) {
    this.model = options.model;
    this.getApiKey = options.getApiKey;
  }

  getCapabilities(): AIProviderCapabilities {
    return { ...DEFAULT_GEMINI_CAPABILITIES };
  }

  async connect(): Promise<void> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      this.lastErrorCode = 'CONFIGURATION';
      this.lastFailureCategory = 'missing_credential';
      this.lastDiagnosticCode = 'INVALID_API_KEY';
      throw new AppError('CONFIGURATION', 'Gemini API key is not configured', {
        details: {
          provider: 'gemini',
          category: 'missing_credential',
          diagnosticCode: 'INVALID_API_KEY',
          model: this.model,
        },
      });
    }
    this.client = new GoogleGenAI({ apiKey });
    this.connected = true;
    this.lastErrorCode = null;
    this.lastFailureCategory = null;
    this.lastDiagnosticCode = null;
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
      provider: 'gemini',
      connected: this.connected,
      model: this.model,
      activeRequestId: this.activeRequestId,
      lastErrorCode: this.lastErrorCode,
    };
  }

  getLastFailureCategory(): GeminiFailureCategory | null {
    return this.lastFailureCategory;
  }

  getLastDiagnosticCode(): GeminiDiagnosticCode | null {
    return this.lastDiagnosticCode;
  }

  /**
   * Minimal live probe — does not stream interview context.
   */
  async testConnection(): Promise<{ latencyMs: number }> {
    if (!this.connected || !this.client) {
      throw new AppError('PROVIDER', 'Gemini provider is not connected', {
        details: {
          provider: 'gemini',
          category: 'provider',
          diagnosticCode: 'UNKNOWN',
          model: this.model,
        },
      });
    }
    const started = Date.now();
    try {
      await this.client.models.generateContent({
        model: this.model,
        contents: 'Reply with the single word: ok',
        config: {
          maxOutputTokens: 8,
          temperature: 0,
        },
      });
      this.lastErrorCode = null;
      this.lastFailureCategory = null;
      this.lastDiagnosticCode = null;
      return { latencyMs: Date.now() - started };
    } catch (error) {
      const latencyMs = Date.now() - started;
      throw this.mapError(error, { latencyMs, model: this.model });
    }
  }

  async *generate(request: AIRequest): AsyncIterable<AIChunk> {
    if (!this.connected || !this.client) {
      throw new AppError('PROVIDER', 'Gemini provider is not connected');
    }

    const capabilities = this.getCapabilities();
    if (!capabilities.textGeneration || !capabilities.streaming) {
      throw new AppError('PROVIDER', 'Gemini text streaming is not supported for this model', {
        details: { category: 'unsupported_capability' },
      });
    }

    const controller = new AbortController();
    this.abortControllers.set(request.requestId, controller);
    this.activeRequestId = request.requestId;

    const systemParts = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const contents = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }));

    let sequence = 0;
    const started = Date.now();
    const model = request.metadata.model || this.model;
    try {
      logger.info('ai.gemini.request.started', {
        requestId: request.requestId,
        provider: 'gemini',
        model,
        messageCount: request.messages.length,
      });
      const stream = await this.client.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: systemParts || undefined,
          temperature: request.metadata.temperature,
          maxOutputTokens: request.metadata.maxOutputTokens,
          abortSignal: controller.signal,
        },
      });

      for await (const part of stream) {
        if (controller.signal.aborted) {
          break;
        }
        const delta = part.text;
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

      if (controller.signal.aborted) {
        this.lastFailureCategory = 'cancelled';
        this.lastDiagnosticCode = 'CANCELLED';
        logger.info('ai.gemini.request.cancelled', {
          requestId: request.requestId,
          provider: 'gemini',
          model,
          latencyMs: Date.now() - started,
          diagnosticCode: 'CANCELLED',
        });
        return;
      }

      yield {
        requestId: request.requestId,
        sequence: sequence++,
        text: '',
        isFinal: true,
      };
      this.lastErrorCode = null;
      this.lastFailureCategory = null;
      this.lastDiagnosticCode = null;
      logger.info('ai.gemini.request.completed', {
        requestId: request.requestId,
        provider: 'gemini',
        model,
        chunkCount: sequence,
        latencyMs: Date.now() - started,
      });
    } catch (error) {
      const latencyMs = Date.now() - started;
      if (controller.signal.aborted || isAbortError(error)) {
        this.lastFailureCategory = 'cancelled';
        this.lastDiagnosticCode = 'CANCELLED';
        logger.info('ai.gemini.request.cancelled', {
          requestId: request.requestId,
          provider: 'gemini',
          model,
          latencyMs,
          diagnosticCode: 'CANCELLED',
        });
        return;
      }
      const mapped = this.mapError(error, { latencyMs, model, requestId: request.requestId });
      throw mapped;
    } finally {
      this.abortControllers.delete(request.requestId);
      if (this.activeRequestId === request.requestId) {
        this.activeRequestId = null;
      }
    }
  }

  private buildErrorDetails(
    classified: GeminiFailureClassification,
    extras?: { latencyMs?: number; model?: string; requestId?: string },
  ): Record<string, unknown> {
    return {
      provider: 'gemini',
      category: classified.category,
      diagnosticCode: classified.diagnosticCode,
      status: classified.status ?? null,
      providerCode: classified.providerCode ?? null,
      errorType: classified.errorType,
      model: extras?.model ?? this.model,
      ...(extras?.latencyMs != null ? { latencyMs: extras.latencyMs } : {}),
      ...(extras?.requestId ? { requestId: extras.requestId } : {}),
    };
  }

  private logGeminiFailure(
    classified: GeminiFailureClassification,
    mapped: AppError,
    extras?: { latencyMs?: number; model?: string; requestId?: string },
  ): void {
    logger.info('ai.gemini.request.failed', {
      provider: 'gemini',
      model: extras?.model ?? this.model,
      requestId: extras?.requestId,
      code: mapped.code,
      category: classified.category,
      diagnosticCode: classified.diagnosticCode,
      status: classified.status ?? null,
      providerCode: classified.providerCode ?? null,
      errorType: classified.errorType,
      message: classified.safeMessage,
      latencyMs: extras?.latencyMs ?? null,
    });
  }

  private mapError(
    error: unknown,
    extras?: { latencyMs?: number; model?: string; requestId?: string },
  ): AppError {
    const classified = classifyGeminiFailure(error);
    this.lastFailureCategory = classified.category;
    this.lastDiagnosticCode = classified.diagnosticCode;
    const details = this.buildErrorDetails(classified, extras);

    if (error instanceof AppError) {
      this.lastErrorCode = error.code;
      const enriched =
        error.details && error.details.diagnosticCode
          ? error
          : new AppError(error.code, error.message, {
              details: { ...error.details, ...details },
              recoverable: error.recoverable,
              exposeToRenderer: error.exposeToRenderer,
            });
      this.logGeminiFailure(classified, enriched, extras);
      return enriched;
    }

    let mapped: AppError;
    if (classified.category === 'authentication') {
      this.lastErrorCode = 'AUTHENTICATION';
      mapped = new AppError('AUTHENTICATION', classified.safeMessage, {
        details,
        recoverable: false,
      });
    } else if (classified.category === 'network' || classified.category === 'timeout') {
      this.lastErrorCode = 'NETWORK';
      mapped = new AppError('NETWORK', classified.safeMessage, {
        details,
        recoverable: true,
      });
    } else if (classified.category === 'invalid_request') {
      this.lastErrorCode = 'VALIDATION';
      mapped = new AppError('VALIDATION', classified.safeMessage, { details });
    } else {
      this.lastErrorCode = 'PROVIDER';
      mapped = new AppError('PROVIDER', classified.safeMessage, { details });
    }

    this.logGeminiFailure(classified, mapped, extras);
    return mapped;
  }
}
