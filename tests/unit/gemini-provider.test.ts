import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  AI_GEMINI_CREDENTIAL_KEY,
  AI_OPENAI_CREDENTIAL_KEY,
  DEFAULT_AI_PUBLIC_CONFIG,
  DEFAULT_GEMINI_MODEL,
  getAiCredentialKey,
} from '../../src/shared/ai/types';
import { DEFAULT_PUBLIC_CONFIG } from '../../src/shared/config/types';
import { createAiProvider } from '../../src/main/ai/createAiProvider';
import {
  classifyGeminiFailure,
  GeminiProvider,
} from '../../src/main/ai/providers/GeminiProvider';
import { MockAIProvider } from '../../src/main/ai/providers/MockAIProvider';
import { AIOrchestrator } from '../../src/core/ai/AIOrchestrator';
import type { AIRequest } from '../../src/shared/ai/types';
import type { DetectedQuestion } from '../../src/shared/questions/types';
import type { ContextSnapshot } from '../../src/shared/context/types';
import { DEFAULT_CONTEXT_BUDGET } from '../../src/shared/context/types';
import { AppError } from '../../src/shared/errors';
import { redactMeta } from '../../src/main/services/logging/redact';
import { AIPublicConfigSchema } from '../../src/core/configuration/schema';

vi.mock('@google/genai', () => {
  const generateContentStream = vi.fn();
  const generateContent = vi.fn();
  class GoogleGenAI {
    models = { generateContentStream, generateContent };
    constructor(_options: { apiKey?: string }) {
      // no-op
    }
  }
  return {
    GoogleGenAI,
    __mock: { generateContentStream, generateContent },
  };
});

async function getGenaiMock() {
  const mod = await import('@google/genai');
  return (mod as unknown as {
    __mock: {
      generateContentStream: ReturnType<typeof vi.fn>;
      generateContent: ReturnType<typeof vi.fn>;
    };
  }).__mock;
}

function question(
  overrides: Partial<DetectedQuestion> & Pick<DetectedQuestion, 'id' | 'text'>,
): DetectedQuestion {
  return {
    originalText: overrides.text,
    normalizedText: overrides.text,
    type: 'technical',
    status: 'classified',
    timestamp: Date.now(),
    sourceSegmentIds: ['s1'],
    detectionConfidence: 0.9,
    classificationConfidence: 0.85,
    isMultiPart: false,
    parts: [],
    parentQuestionId: null,
    relatedQuestionId: null,
    ...overrides,
  };
}

function contextFor(q: DetectedQuestion): ContextSnapshot {
  return {
    id: 'ctx-1',
    sessionId: 'sess-1',
    correlationId: 'corr-1',
    questionId: q.id,
    currentQuestion: q,
    recentTranscript: [],
    recentQuestions: [],
    relatedQuestions: [],
    userContext: { role: 'Engineer' },
    projectContext: { projectName: 'AP Assistant', technologies: ['Electron'] },
    visualContext: null,
    interviewDocuments: null,
    createdAt: Date.now(),
    metadata: {
      truncated: false,
      omittedTranscriptSegments: 0,
      omittedQuestions: 0,
      omittedDocumentExcerpts: 0,
      documentTruncated: false,
      sources: ['session'],
      characterCount: 40,
      budget: { ...DEFAULT_CONTEXT_BUDGET },
    },
    quality: {
      completeness: 1,
      transcriptCoverage: 1,
      relationshipCoverage: 1,
      truncated: false,
    },
  };
}

function sampleRequest(overrides?: Partial<AIRequest>): AIRequest {
  const q = question({ id: 'q1', text: 'Explain polymorphism.' });
  return {
    requestId: 'req-gemini-1',
    sessionId: 'sess-1',
    correlationId: 'corr-1',
    question: q,
    context: contextFor(q),
    responseMode: 'normal',
    messages: [
      { role: 'system', content: 'You are an interview assistant.' },
      { role: 'user', content: 'Explain polymorphism.\n\nContext: Java services.' },
    ],
    metadata: {
      model: DEFAULT_GEMINI_MODEL,
      temperature: 0.4,
      maxOutputTokens: 200,
      responseMode: 'normal',
      provider: 'gemini',
      contextId: 'ctx-1',
      questionId: 'q1',
    },
    ...overrides,
  };
}

describe('Gemini credential keys and config', () => {
  it('uses a dedicated vault key and never places apiKey in public config', () => {
    expect(AI_GEMINI_CREDENTIAL_KEY).toBe('ai.gemini.apiKey');
    expect(getAiCredentialKey('gemini')).toBe(AI_GEMINI_CREDENTIAL_KEY);
    expect(getAiCredentialKey('openai')).toBe(AI_OPENAI_CREDENTIAL_KEY);
    expect(getAiCredentialKey('mock')).toBeNull();

    const publicJson = JSON.stringify(DEFAULT_PUBLIC_CONFIG);
    expect(publicJson).not.toMatch(/apiKey|AIza/);
    expect(DEFAULT_PUBLIC_CONFIG.ai).not.toHaveProperty('apiKey');
    expect(AIPublicConfigSchema.safeParse({
      ...DEFAULT_AI_PUBLIC_CONFIG,
      provider: 'gemini',
      model: DEFAULT_GEMINI_MODEL,
    }).success).toBe(true);
  });

  it('redacts Gemini-looking secrets from logs', () => {
    const redacted = redactMeta({
      apiKey: 'AIzaSyDummyGeminiKeyValue1234567890',
      note: 'token AIzaSyDummyGeminiKeyValue1234567890 leaked',
    });
    expect(JSON.stringify(redacted)).not.toContain('AIzaSy');
  });
});

describe('createAiProvider factory', () => {
  it('selects GeminiProvider when provider=gemini', () => {
    const provider = createAiProvider({
      config: { ...DEFAULT_AI_PUBLIC_CONFIG, provider: 'gemini', model: DEFAULT_GEMINI_MODEL },
      getApiKey: async () => 'AIza-test',
    });
    expect(provider.getStatus().provider).toBe('gemini');
    expect(provider.getCapabilities?.().streaming).toBe(true);
  });

  it('keeps MockAI independent of Gemini credentials', async () => {
    const provider = createAiProvider({
      config: { ...DEFAULT_AI_PUBLIC_CONFIG, provider: 'mock', model: 'mock-answer-v1' },
      getApiKey: async () => null,
    });
    expect(provider).toBeInstanceOf(MockAIProvider);
    await provider.connect();
    const chunks: string[] = [];
    for await (const chunk of provider.generate(sampleRequest({ metadata: {
      ...sampleRequest().metadata,
      provider: 'mock',
      model: 'mock-answer-v1',
    }}))) {
      if (chunk.text) chunks.push(chunk.text);
    }
    expect(chunks.join('').length).toBeGreaterThan(0);
  });
});

describe('GeminiProvider', () => {
  beforeEach(async () => {
    const mock = await getGenaiMock();
    mock.generateContentStream.mockReset();
    mock.generateContent.mockReset();
  });

  it('fails connect when Gemini key is missing', async () => {
    const provider = new GeminiProvider({
      model: DEFAULT_GEMINI_MODEL,
      getApiKey: async () => null,
    });
    await expect(provider.connect()).rejects.toMatchObject({
      code: 'CONFIGURATION',
      message: expect.stringMatching(/not configured/i),
    });
  });

  it('connects using the vault-supplied key without exposing it on status', async () => {
    const provider = new GeminiProvider({
      model: DEFAULT_GEMINI_MODEL,
      getApiKey: async () => 'AIzaSyVaultSecretKeyValueXXXXXXXX',
    });
    await provider.connect();
    const status = provider.getStatus();
    expect(status.connected).toBe(true);
    expect(status.provider).toBe('gemini');
    expect(JSON.stringify(status)).not.toContain('AIzaSy');
  });

  it('streams deltas into the existing AIChunk contract', async () => {
    const mock = await getGenaiMock();
    mock.generateContentStream.mockResolvedValue(
      (async function* () {
        yield { text: 'Hello ' };
        yield { text: 'Gemini' };
      })(),
    );

    const provider = new GeminiProvider({
      model: DEFAULT_GEMINI_MODEL,
      getApiKey: async () => 'AIza-test',
    });
    await provider.connect();
    const request = sampleRequest();
    const chunks = [];
    for await (const chunk of provider.generate(request)) {
      chunks.push(chunk);
    }
    expect(chunks.filter((c) => !c.isFinal).map((c) => c.text).join('')).toBe('Hello Gemini');
    expect(chunks.at(-1)?.isFinal).toBe(true);
    expect(chunks.every((c) => c.requestId === request.requestId)).toBe(true);

    const call = mock.generateContentStream.mock.calls[0]?.[0] as {
      model: string;
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
      config: { systemInstruction?: string };
    };
    expect(call.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(call.config.systemInstruction).toContain('interview assistant');
    expect(call.contents[0]?.parts[0]?.text).toContain('polymorphism');
  });

  it('cancels an active Gemini generation', async () => {
    const mock = await getGenaiMock();
    mock.generateContentStream.mockImplementation(async () => {
      return (async function* () {
        yield { text: 'partial' };
        await new Promise((resolve) => setTimeout(resolve, 80));
        yield { text: ' should-not-appear' };
      })();
    });

    const provider = new GeminiProvider({
      model: DEFAULT_GEMINI_MODEL,
      getApiKey: async () => 'AIza-test',
    });
    await provider.connect();
    const request = sampleRequest({ requestId: 'cancel-me' });
    const texts: string[] = [];
    const gen = (async () => {
      for await (const chunk of provider.generate(request)) {
        if (chunk.text) texts.push(chunk.text);
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await provider.cancel('cancel-me');
    await gen;
    expect(texts.join('')).not.toContain('should-not-appear');
  });

  it('testConnection success returns latency without credentials', async () => {
    const mock = await getGenaiMock();
    mock.generateContent.mockResolvedValue({ text: 'ok' });
    const provider = new GeminiProvider({
      model: DEFAULT_GEMINI_MODEL,
      getApiKey: async () => 'AIza-test',
    });
    await provider.connect();
    const result = await provider.testConnection();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toMatch(/AIza|apiKey/i);
  });

  it('testConnection failure maps to friendly auth error', async () => {
    const mock = await getGenaiMock();
    mock.generateContent.mockRejectedValue({
      status: 401,
      message: 'API key not valid. Please pass a valid API key. AIzaSyShouldNotLeak',
    });
    const provider = new GeminiProvider({
      model: DEFAULT_GEMINI_MODEL,
      getApiKey: async () => 'AIza-test',
    });
    await provider.connect();
    await expect(provider.testConnection()).rejects.toMatchObject({
      message: 'Gemini API key is invalid.',
    });
  });
});

describe('Gemini failure classification', () => {
  it('maps invalid key, quota, rate limit, network, and model errors', () => {
    expect(
      classifyGeminiFailure({ status: 401, message: 'API key not valid' }).safeMessage,
    ).toBe('Gemini API key is invalid.');
    expect(
      classifyGeminiFailure({ status: 401, message: 'API key not valid' }).diagnosticCode,
    ).toBe('INVALID_API_KEY');
    expect(
      classifyGeminiFailure({
        status: 429,
        code: 'RESOURCE_EXHAUSTED',
        message: 'Quota exceeded for metric',
      }).category,
    ).toBe('quota_billing');
    expect(
      classifyGeminiFailure({
        status: 429,
        code: 'RESOURCE_EXHAUSTED',
        message: 'Quota exceeded for metric',
      }).diagnosticCode,
    ).toBe('QUOTA_EXCEEDED');
    expect(
      classifyGeminiFailure({ status: 429, message: 'Rate limit exceeded' }).category,
    ).toBe('rate_limit');
    expect(
      classifyGeminiFailure({ status: 429, message: 'Rate limit exceeded' }).diagnosticCode,
    ).toBe('RATE_LIMITED');
    expect(
      classifyGeminiFailure({ message: 'fetch failed: ENOTFOUND' }).category,
    ).toBe('network');
    expect(
      classifyGeminiFailure({ message: 'fetch failed: ENOTFOUND' }).diagnosticCode,
    ).toBe('NETWORK_ERROR');
    expect(
      classifyGeminiFailure({ status: 404, message: 'models/gemini-x is not found' }).category,
    ).toBe('model_unavailable');
    expect(
      classifyGeminiFailure({ status: 404, message: 'models/gemini-x is not found' }).diagnosticCode,
    ).toBe('MODEL_UNAVAILABLE');
    expect(
      classifyGeminiFailure({ status: 404, message: 'models/gemini-x is not found' }).safeMessage,
    ).toMatch(/gemini-3\.8-flash/i);
    const leaked = classifyGeminiFailure({
      status: 401,
      message: 'bad key AIzaSyDummyGeminiKeyValue1234567890',
    });
    expect(leaked.safeMessage).not.toContain('AIzaSy');
  });

  it('distinguishes diagnostic codes for auth, forbidden, timeout, and invalid request', () => {
    expect(
      classifyGeminiFailure({ status: 401, message: 'Unauthorized' }).diagnosticCode,
    ).toBe('UNAUTHORIZED');
    expect(
      classifyGeminiFailure({ status: 403, message: 'Permission denied' }).diagnosticCode,
    ).toBe('FORBIDDEN');
    expect(
      classifyGeminiFailure({ status: 400, message: 'Invalid argument: temperature' }).diagnosticCode,
    ).toBe('INVALID_REQUEST');
    expect(
      classifyGeminiFailure({ message: 'Request deadline exceeded (timeout)' }).diagnosticCode,
    ).toBe('TIMEOUT');
    expect(
      classifyGeminiFailure({ status: 503, message: 'Service Unavailable' }).diagnosticCode,
    ).toBe('UNKNOWN');
    expect(classifyGeminiFailure({ message: 'weird failure xyz' }).diagnosticCode).toBe('UNKNOWN');
  });

  it('maps AppError details without dropping diagnosticCode', () => {
    const err = new AppError('PROVIDER', 'Gemini model is unavailable.', {
      details: {
        category: 'model_unavailable',
        diagnosticCode: 'MODEL_UNAVAILABLE',
        status: 404,
      },
    });
    const classified = classifyGeminiFailure(err);
    expect(classified.diagnosticCode).toBe('MODEL_UNAVAILABLE');
    expect(classified.category).toBe('model_unavailable');
  });

  it('attaches diagnosticCode on mapped generate failures', async () => {
    const mock = await getGenaiMock();
    mock.generateContentStream.mockRejectedValue({
      status: 404,
      message: 'models/gemini-broken is not found',
    });
    const provider = new GeminiProvider({
      model: DEFAULT_GEMINI_MODEL,
      getApiKey: async () => 'test-key',
    });
    await provider.connect();
    await expect(async () => {
      for await (const _ of provider.generate(sampleRequest())) {
        // drain
      }
    }).rejects.toMatchObject({
      code: 'PROVIDER',
      message: expect.stringMatching(/unavailable/i),
      details: expect.objectContaining({
        diagnosticCode: 'MODEL_UNAVAILABLE',
        category: 'model_unavailable',
        provider: 'gemini',
      }),
    });
    expect(provider.getLastDiagnosticCode()).toBe('MODEL_UNAVAILABLE');
  });
});

describe('AIOrchestrator with Gemini selection', () => {
  it('uses Gemini provider through the shared orchestrator request shape', async () => {
    const mock = await getGenaiMock();
    mock.generateContentStream.mockResolvedValue(
      (async function* () {
        yield { text: 'Polymorphism lets subtypes' };
        yield { text: ' share a contract.' };
      })(),
    );

    const q = question({ id: 'q-gem', text: 'What is polymorphism?' });
    const ctx = contextFor(q);
    const orchestrator = new AIOrchestrator({
      idGenerator: (() => {
        let n = 0;
        return () => `g-${++n}`;
      })(),
      getConfig: () => ({
        ...DEFAULT_AI_PUBLIC_CONFIG,
        provider: 'gemini',
        model: DEFAULT_GEMINI_MODEL,
        autoGenerate: false,
      }),
      isConfigured: async () => true,
      createProvider: (config) =>
        createAiProvider({
          config,
          getApiKey: async () => 'AIza-test',
        }),
      getQuestion: () => q,
      getContextForQuestion: () => ctx,
    });

    const result = await orchestrator.generate({ question: q, context: ctx, force: true });
    expect(result.status).toBe('completed');
    expect(result.text).toContain('Polymorphism');
    expect(result.metadata.provider).toBe('gemini');
  });
});
