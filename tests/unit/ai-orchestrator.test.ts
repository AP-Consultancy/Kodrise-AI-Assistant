import { describe, expect, it } from 'vitest';
import { PromptBuilder } from '../../src/core/prompts/PromptBuilder';
import { AIOrchestrator } from '../../src/core/ai/AIOrchestrator';
import { AIResponseManager } from '../../src/core/ai/AIResponseManager';
import { MockAIProvider } from '../../src/main/ai/providers/MockAIProvider';
import type { DetectedQuestion } from '../../src/shared/questions/types';
import type { ContextSnapshot } from '../../src/shared/context/types';
import { DEFAULT_CONTEXT_BUDGET } from '../../src/shared/context/types';
import { DEFAULT_AI_PUBLIC_CONFIG } from '../../src/shared/ai/types';
import { AIGenerateSchema, AICancelSchema } from '../../src/shared/ipc/schemas';
import { toSafeErrorPayload, ValidationError } from '../../src/shared/errors';

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
    recentTranscript: [
      {
        id: 't1',
        text: 'We used JWT for auth.',
        timestamp: Date.now(),
        startTime: Date.now(),
        endTime: Date.now(),
        isFinal: true,
        confidence: 0.9,
      },
    ],
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
      sources: ['session', 'transcript', 'user_context', 'project_context'],
      characterCount: 120,
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

describe('PromptBuilder', () => {
  it('builds system + user messages with response mode guidance', () => {
    const builder = new PromptBuilder();
    const q = question({ id: 'q1', text: 'How did you implement authentication?' });
    const messages = builder.build({
      question: q,
      context: contextFor(q),
      responseMode: 'short',
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toMatch(/SHORT/i);
    expect(messages[1]?.content).toContain('How did you implement authentication?');
    expect(messages[1]?.content).toContain('AP Assistant');
    expect(messages[1]?.content).not.toMatch(/apiKey|sk-/i);
  });
});

describe('AIResponseManager', () => {
  it('tracks streaming lifecycle and latency metadata', () => {
    const manager = new AIResponseManager({ idGenerator: () => 'resp-1' });
    const started = manager.begin({
      requestId: 'req-1',
      questionId: 'q1',
      sessionId: 's1',
      correlationId: 'c1',
      provider: 'mock',
      model: 'mock',
      responseMode: 'normal',
    });
    expect(started.status).toBe('preparing');
    manager.markGenerating();
    manager.appendChunk('Hello');
    const completed = manager.complete({ totalTokens: 10 });
    expect(completed?.status).toBe('completed');
    expect(completed?.text).toBe('Hello');
    expect(completed?.metadata.latencyMs).toBeTypeOf('number');
    expect(completed?.metadata.timeToFirstTokenMs).toBeTypeOf('number');
  });
});

describe('AIOrchestrator + MockAIProvider', () => {
  it('streams a complete response and prevents duplicate auto generation', async () => {
    const q = question({ id: 'q1', text: 'Why PostgreSQL?' });
    const ctx = contextFor(q);
    const events: string[] = [];
    const orchestrator = new AIOrchestrator({
      idGenerator: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      getConfig: () => ({
        ...DEFAULT_AI_PUBLIC_CONFIG,
        provider: 'mock',
        autoGenerate: true,
        model: 'mock-answer-v1',
      }),
      isConfigured: async () => true,
      createProvider: () => new MockAIProvider({ model: 'mock-answer-v1' }),
      getQuestion: (id) => (id === q.id ? q : null),
      getContextForQuestion: (id) => (id === q.id ? ctx : null),
    });
    orchestrator.subscribe((event) => events.push(event.type));

    const first = await orchestrator.maybeAutoGenerate({ question: q, context: ctx });
    expect(first?.status).toBe('completed');
    expect(first?.text.length).toBeGreaterThan(0);
    expect(events).toContain('ai.request.started');
    expect(events).toContain('ai.response.chunk');
    expect(events).toContain('ai.response.completed');

    const second = await orchestrator.maybeAutoGenerate({ question: q, context: ctx });
    expect(second).toBeNull();
  });

  it('supports manual generate and cancel', async () => {
    const q = question({ id: 'q2', text: 'Explain caching.' });
    const ctx = contextFor(q);
    const provider = new MockAIProvider({ model: 'mock' });
    const orchestrator = new AIOrchestrator({
      idGenerator: (() => {
        let n = 0;
        return () => `m-${++n}`;
      })(),
      getConfig: () => ({
        ...DEFAULT_AI_PUBLIC_CONFIG,
        provider: 'mock',
        autoGenerate: false,
      }),
      isConfigured: async () => true,
      createProvider: () => provider,
      getQuestion: () => q,
      getContextForQuestion: () => ctx,
    });

    const generatePromise = orchestrator.generate({ question: q, context: ctx, force: true });
    await new Promise((resolve) => setTimeout(resolve, 8));
    const status = await orchestrator.getStatus();
    if (status.activeRequestId) {
      await orchestrator.cancel(status.activeRequestId);
    }
    const result = await generatePromise;
    expect(['cancelled', 'completed']).toContain(result.status);
  });

  it('session stop clears responses and disables generation', async () => {
    const q = question({ id: 'q3', text: 'What is Redis?' });
    const orchestrator = new AIOrchestrator({
      idGenerator: () => 's-1',
      getConfig: () => ({ ...DEFAULT_AI_PUBLIC_CONFIG, provider: 'mock' }),
      isConfigured: async () => true,
      createProvider: () => new MockAIProvider(),
    });
    await orchestrator.generate({ question: q, context: contextFor(q), force: true });
    orchestrator.resetForSessionStop();
    expect(orchestrator.isEnabled()).toBe(false);
    expect(orchestrator.getCurrentResponse()).toBeNull();
  });
});

describe('AI IPC contracts', () => {
  it('validates generate and cancel payloads', () => {
    expect(AIGenerateSchema.safeParse({ questionId: 'q1' }).success).toBe(true);
    expect(AIGenerateSchema.safeParse({}).success).toBe(false);
    expect(AICancelSchema.safeParse({ requestId: 'r1' }).success).toBe(true);
    expect(AICancelSchema.safeParse({}).success).toBe(true);
  });

  it('maps validation errors safely without secrets', () => {
    const payload = toSafeErrorPayload(new ValidationError('Invalid AI generate payload'));
    expect(payload.code).toBe('VALIDATION');
    expect(JSON.stringify(payload)).not.toMatch(/apiKey|sk-/i);
  });
});

describe('OpenAI failure classification', () => {
  it('distinguishes quota, rate limit, and authentication safely', async () => {
    const { classifyOpenAiFailure } = await import(
      '../../src/main/ai/providers/OpenAIProvider'
    );

    expect(
      classifyOpenAiFailure({
        status: 429,
        code: 'insufficient_quota',
        message: 'You exceeded your current quota, please check your plan and billing details.',
      }).category,
    ).toBe('quota_billing');

    expect(
      classifyOpenAiFailure({
        status: 429,
        code: 'rate_limit_exceeded',
        message: 'Rate limit reached',
      }).category,
    ).toBe('rate_limit');

    const auth = classifyOpenAiFailure({
      status: 401,
      message: 'Incorrect API key provided: sk-test-should-not-leak',
    });
    expect(auth.category).toBe('authentication');
    expect(auth.safeMessage).not.toContain('sk-test');
  });
});
