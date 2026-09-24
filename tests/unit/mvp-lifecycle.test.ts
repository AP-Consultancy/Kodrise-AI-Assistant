import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigurationService } from '../../src/core/configuration/ConfigurationService';
import { SessionManager } from '../../src/core/session/SessionManager';
import { TranscriptStore } from '../../src/core/transcription/TranscriptStore';
import { QuestionManager } from '../../src/core/questions/QuestionManager';
import { ContextBuilder } from '../../src/core/context/ContextBuilder';
import { ContextEngine } from '../../src/core/context/ContextEngine';
import { DocumentRelevanceSelector } from '../../src/core/documents/DocumentRelevanceSelector';
import { InterviewSessionContextStore } from '../../src/core/interview/InterviewSessionContextStore';
import { TextDocumentExtractor, CompositeDocumentExtractor } from '../../src/core/documents';
import { AIOrchestrator } from '../../src/core/ai/AIOrchestrator';
import { PromptBuilder } from '../../src/core/prompts/PromptBuilder';
import { MockAIProvider } from '../../src/main/ai/providers/MockAIProvider';
import { QUESTION_BUFFER } from '../../src/shared/questions/types';
import { DEFAULT_AI_PUBLIC_CONFIG } from '../../src/shared/ai/types';
import {
  DEFAULT_CONTEXT_BUDGET,
  DEFAULT_CONTEXT_PUBLIC_CONFIG,
} from '../../src/shared/context/types';
import type { DetectedQuestion } from '../../src/shared/questions/types';
import type { ContextSnapshot } from '../../src/shared/context/types';
import type { AIEvent, AIResponseState } from '../../src/shared/ai/types';
import type { QuestionEvent } from '../../src/shared/questions/types';
import type { VisualIntelligenceEvent } from '../../src/shared/visual-intelligence/types';
import type { AIProvider } from '../../src/core/ai/AIProvider';
import type { AudioHost } from '../../src/main/services/audio/AudioHost';
import type { VisualContextHost } from '../../src/main/visual/VisualContextHost';
import type { SessionHost } from '../../src/main/services/session/SessionHost';
import type { InterviewHost } from '../../src/main/interview/InterviewHost';

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('../../src/main/services/logging', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function question(
  overrides: Partial<DetectedQuestion> & Pick<DetectedQuestion, 'id' | 'text'>,
): DetectedQuestion {
  return {
    originalText: overrides.text,
    normalizedText: overrides.text.toLowerCase(),
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
    userContext: null,
    projectContext: null,
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

function aiEvent(partial: Partial<AIEvent> & Pick<AIEvent, 'type'>): AIEvent {
  return {
    requestId: 'req-1',
    responseId: 'resp-1',
    questionId: 'q1',
    sessionId: 'sess-test',
    correlationId: 'corr',
    timestamp: Date.now(),
    ...partial,
  };
}

type AiListener = (event: AIEvent) => void;
type QuestionListener = (event: QuestionEvent) => void;
type VisualListener = (event: VisualIntelligenceEvent) => void;

function createInterviewHarness() {
  const config = new ConfigurationService();
  const sessionManager = new SessionManager(() => 'sess-test');
  const session = {
    getManager: () => sessionManager,
  } as unknown as SessionHost;

  let currentQuestion: DetectedQuestion | null = null;
  let currentResponse: AIResponseState | null = null;
  const aiListeners = new Set<AiListener>();
  const questionListeners = new Set<QuestionListener>();
  const visualListeners = new Set<VisualListener>();

  const calls = {
    cancelAi: 0,
    forceStop: 0,
    clearTranscript: 0,
    clearQuestions: 0,
    clearAiResponses: 0,
    pauseAudio: 0,
    resumeAudio: 0,
    setQuestionProcessing: [] as boolean[],
    setMicrophoneQuestionIngest: [] as boolean[],
    processSimulated: 0,
    processManual: 0,
    visualStart: 0,
    visualStop: 0,
    visualPause: 0,
    visualResume: 0,
    visualClear: 0,
    visualClearIntel: 0,
  };

  let microphoneQuestionIngest = true;

  const audio = {
    setQuestionProcessingEnabled: (enabled: boolean) => {
      calls.setQuestionProcessing.push(enabled);
    },
    setMicrophoneQuestionIngest: (enabled: boolean) => {
      microphoneQuestionIngest = enabled;
      calls.setMicrophoneQuestionIngest.push(enabled);
    },
    isMicrophoneQuestionIngestEnabled: () => microphoneQuestionIngest,
    pause: async () => {
      calls.pauseAudio += 1;
      return { state: 'paused' };
    },
    resume: async () => {
      calls.resumeAudio += 1;
      return { state: 'active' };
    },
    cancelAi: async () => {
      calls.cancelAi += 1;
      for (const listener of aiListeners) {
        listener(aiEvent({ type: 'ai.response.cancelled' }));
      }
      return null;
    },
    forceStopFromSession: async () => {
      calls.forceStop += 1;
    },
    clearTranscript: () => {
      calls.clearTranscript += 1;
      return { finals: [], partialText: null };
    },
    clearQuestions: () => {
      calls.clearQuestions += 1;
      currentQuestion = null;
      return { current: null, recent: [], count: 0 };
    },
    clearAiResponses: async () => {
      calls.clearAiResponses += 1;
      currentResponse = null;
      return { provider: 'mock', model: 'mock', status: 'idle' };
    },
    getCurrentQuestion: () => currentQuestion,
    getCurrentAiResponse: () => currentResponse,
    processManualQuestion: (text: string) => {
      calls.processManual += 1;
      const q = question({ id: `manual-${text.length}`, text });
      currentQuestion = q;
      const event: QuestionEvent = {
        type: 'question.classified',
        questionId: q.id,
        timestamp: Date.now(),
        sessionId: 'sess-test',
        correlationId: 'corr',
        question: q,
      };
      for (const listener of questionListeners) listener(event);
      return [q];
    },
    processSimulatedQuestion: (
      text: string,
      _options?: { simulationQuestionId?: string },
    ) => {
      calls.processSimulated += 1;
      const q = question({
        id: `sim-${calls.processSimulated}`,
        text,
        sourceSegmentIds: ['simulation'],
      });
      currentQuestion = q;
      const event: QuestionEvent = {
        type: 'question.classified',
        questionId: q.id,
        timestamp: Date.now(),
        sessionId: 'sess-test',
        correlationId: 'corr',
        question: q,
      };
      for (const listener of questionListeners) listener(event);
      return [q];
    },
    generateAiAnswer: async () => {
      currentResponse = {
        id: 'resp-1',
        requestId: 'req-1',
        questionId: currentQuestion?.id ?? 'q1',
        sessionId: 'sess-test',
        correlationId: 'corr',
        status: 'generating',
        text: '',
        startedAt: Date.now(),
        firstTokenAt: null,
        completedAt: null,
        error: null,
        metadata: {
          model: 'mock',
          provider: 'mock',
          responseMode: 'normal',
          usage: null,
          latencyMs: null,
          timeToFirstTokenMs: null,
          truncated: false,
        },
      };
      for (const listener of aiListeners) {
        listener(aiEvent({ type: 'ai.request.started', questionId: currentQuestion?.id ?? 'q1' }));
        listener(aiEvent({ type: 'ai.response.started', questionId: currentQuestion?.id ?? 'q1' }));
        listener(
          aiEvent({
            type: 'ai.response.chunk',
            questionId: currentQuestion?.id ?? 'q1',
            textDelta: 'Mock answer',
          }),
        );
      }
      currentResponse = {
        ...currentResponse,
        status: 'completed',
        text: 'Mock answer',
        completedAt: Date.now(),
      };
      for (const listener of aiListeners) {
        listener(
          aiEvent({
            type: 'ai.response.completed',
            questionId: currentQuestion?.id ?? 'q1',
            status: 'completed',
          }),
        );
      }
      return currentResponse;
    },
    subscribeQuestions: (listener: QuestionListener) => {
      questionListeners.add(listener);
      return () => questionListeners.delete(listener);
    },
    subscribeAi: (listener: AiListener) => {
      aiListeners.add(listener);
      return () => aiListeners.delete(listener);
    },
  } as unknown as AudioHost;

  const visual = {
    onSessionStart: async () => {
      calls.visualStart += 1;
    },
    onSessionStop: async () => {
      calls.visualStop += 1;
    },
    onSessionPause: async () => {
      calls.visualPause += 1;
      return { state: 'paused' };
    },
    onSessionResume: async () => {
      calls.visualResume += 1;
      return { state: 'capturing' };
    },
    clear: () => {
      calls.visualClear += 1;
      return { state: 'idle' };
    },
    clearIntelligenceResults: () => {
      calls.visualClearIntel += 1;
      return { lastResult: null, recentResults: [] };
    },
    subscribeIntelligence: (listener: VisualListener) => {
      visualListeners.add(listener);
      return () => visualListeners.delete(listener);
    },
  } as unknown as VisualContextHost;

  return {
    config,
    session,
    audio,
    visual,
    calls,
    aiListeners,
    questionListeners,
    visualListeners,
    setCurrentQuestion: (q: DetectedQuestion | null) => {
      currentQuestion = q;
    },
  };
}

describe('Phase 2K — clean startup', () => {
  it('InterviewHost starts in prepare with no listening and no capture activity', async () => {
    const { InterviewHost: Host } = await import('../../src/main/interview/InterviewHost');
    const harness = createInterviewHarness();
    const host = new Host(harness);
    const status = host.getStatus();
    expect(status.phase).toBe('prepare');
    expect(status.listening).toBe(false);
    expect(status.paused).toBe(false);
    expect(status.uiState).toBe('idle');
    expect(harness.calls.visualStart).toBe(0);
    expect(harness.calls.setQuestionProcessing).toEqual([]);
    host.dispose();
  });
});

describe('Phase 2K — interview lifecycle', () => {
  let host: InterviewHost;
  let harness: ReturnType<typeof createInterviewHarness>;

  beforeEach(async () => {
    const { InterviewHost: Host } = await import('../../src/main/interview/InterviewHost');
    harness = createInterviewHarness();
    host = new Host(harness);
  });

  afterEach(() => {
    host.dispose();
  });

  it('start → pause cancels AI → resume → end cleans up resources', async () => {
    await host.startInterview();
    let status = host.getStatus();
    expect(status.phase).toBe('live');
    expect(status.listening).toBe(true);
    expect(status.uiState).toBe('listening');
    expect(status.paused).toBe(false);
    expect(harness.config.getPublic().ai.autoGenerate).toBe(true);
    expect(harness.calls.setQuestionProcessing.at(-1)).toBe(true);
    expect(harness.calls.visualStart).toBe(1);
    expect(harness.calls.clearTranscript).toBeGreaterThanOrEqual(1);

    status = await host.pauseInterview();
    expect(status.paused).toBe(true);
    expect(status.listening).toBe(false);
    expect(status.uiState).toBe('paused');
    expect(harness.calls.cancelAi).toBe(1);
    expect(harness.calls.pauseAudio).toBe(1);
    expect(harness.calls.visualPause).toBe(1);
    expect(harness.calls.setQuestionProcessing.at(-1)).toBe(false);

    // Stale AI completion while paused must not flip UI to ready.
    for (const listener of harness.aiListeners) {
      listener(aiEvent({ type: 'ai.response.completed', status: 'completed' }));
    }
    expect(host.getStatus().uiState).toBe('paused');

    status = await host.resumeInterview();
    expect(status.paused).toBe(false);
    expect(status.listening).toBe(true);
    expect(status.uiState).toBe('listening');
    expect(harness.calls.resumeAudio).toBe(1);
    expect(harness.calls.visualResume).toBe(1);

    status = await host.endInterview();
    expect(status.phase).toBe('summary');
    expect(status.listening).toBe(false);
    expect(status.paused).toBe(false);
    expect(status.summary).not.toBeNull();
    expect(harness.calls.cancelAi).toBeGreaterThanOrEqual(2);
    expect(harness.calls.forceStop).toBe(1);
    expect(harness.calls.clearTranscript).toBeGreaterThanOrEqual(2);
    expect(harness.calls.visualStop).toBe(1);
    expect(harness.calls.visualClearIntel).toBeGreaterThanOrEqual(1);
    expect(harness.config.getPublic().ai.autoGenerate).toBe(false);
  });

  it('new interview isolates documents and transient pipeline state', async () => {
    await host.addDocumentBytes({
      kind: 'resume',
      fileName: 'resume.txt',
      mimeType: 'text/plain',
      bytesBase64: Buffer.from('Java Spring Boot Kafka').toString('base64'),
    });
    expect(host.getDocuments().documentCount).toBe(1);

    await host.startInterview();
    await host.endInterview();
    const status = host.newInterview();

    expect(status.phase).toBe('prepare');
    expect(status.uiState).toBe('idle');
    expect(host.getDocuments().documentCount).toBe(0);
    expect(status.summary).toBeNull();
    expect(harness.calls.clearTranscript).toBeGreaterThanOrEqual(1);
    expect(harness.calls.clearQuestions).toBeGreaterThanOrEqual(1);
    expect(harness.calls.clearAiResponses).toBeGreaterThanOrEqual(1);
    expect(harness.calls.visualClear).toBe(1);
  });

  it('does not allow contradictory listening + paused state', async () => {
    await host.startInterview();
    await host.pauseInterview();
    const status = host.getStatus();
    expect(status.paused).toBe(true);
    expect(status.listening).toBe(false);
  });

  it('blocks regenerate and manual questions while paused', async () => {
    await host.startInterview();
    harness.setCurrentQuestion(question({ id: 'q1', text: 'What is Spring Boot?' }));
    await host.pauseInterview();
    await expect(host.regenerate()).rejects.toThrow(/resume/i);
    await expect(host.submitManualQuestion('Why Kafka?')).rejects.toThrow(/resume/i);
  });
});

describe('Phase 2K — MockAI end-to-end pipeline', () => {
  it('streams answer through orchestrator and prevents duplicate generation', async () => {
    const q = question({ id: 'q-mock-1', text: 'What is Spring Boot?' });
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

    const duplicate = await orchestrator.maybeAutoGenerate({ question: q, context: ctx });
    expect(duplicate).toBeNull();

    await orchestrator.cancel();
    orchestrator.resetForSessionStop();
    const status = await orchestrator.getStatus();
    expect(status.activeRequestId).toBeNull();
  });

  it('PromptBuilder + MockAI path does not require OpenAI', async () => {
    const q = question({ id: 'q-pb', text: 'Tell me about this project.' });
    const messages = new PromptBuilder().build({
      question: q,
      context: contextFor(q),
      responseMode: 'normal',
    });
    const provider = new MockAIProvider({ model: 'mock' });
    await provider.connect();
    const chunks: string[] = [];
    for await (const chunk of provider.generate({
      requestId: 'req-pb',
      sessionId: 's',
      correlationId: 'c',
      question: q,
      context: contextFor(q),
      responseMode: 'normal',
      messages,
      metadata: {
        model: 'mock',
        temperature: 0.2,
        maxOutputTokens: 200,
        responseMode: 'normal',
        provider: 'mock',
        contextId: 'ctx-1',
        questionId: q.id,
      },
    })) {
      if (chunk.text) chunks.push(chunk.text);
    }
    expect(chunks.join('').length).toBeGreaterThan(0);
  });
});

describe('Phase 2K — document prepare + failure fallback', () => {
  it('marks ready documents and keeps failed uploads out of context candidates', async () => {
    const store = new InterviewSessionContextStore({
      extractor: new CompositeDocumentExtractor([new TextDocumentExtractor()]),
    });

    const resume = await store.addDocument({
      kind: 'resume',
      fileName: 'resume.txt',
      mimeType: 'text/plain',
      bytes: new TextEncoder().encode('Spring Boot Kafka TypeScript'),
    });
    expect(resume.status).toBe('ready');

    await expect(
      store.addDocument({
        kind: 'additional',
        fileName: 'photo.png',
        mimeType: 'image/png',
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toThrow();

    expect(store.getPublic().resume?.status).toBe('ready');
    const candidates = store.getCandidates();
    expect(candidates.some((doc) => doc.fileName === 'photo.png')).toBe(false);
    expect(candidates).toHaveLength(1);
  });

  it('empty document is not treated as ready context', async () => {
    const store = new InterviewSessionContextStore({
      extractor: new TextDocumentExtractor(),
    });
    await expect(
      store.addDocument({
        kind: 'job_description',
        fileName: 'empty.txt',
        mimeType: 'text/plain',
        bytes: new TextEncoder().encode('   '),
      }),
    ).rejects.toThrow();
  });
});

describe('Phase 2K — context relevance + budget', () => {
  it('selects relevant documents and keeps context bounded', () => {
    const selector = new DocumentRelevanceSelector();
    const q = question({ id: 'q-ctx', text: 'Why was Kafka used?' });
    const selected = selector.select({
      question: q,
      documents: [
        {
          id: 'r1',
          fileName: 'resume.txt',
          kind: 'resume',
          text: 'Built Kafka event pipelines for order processing.',
          truncated: false,
        },
        {
          id: 'jd1',
          fileName: 'jd.txt',
          kind: 'job_description',
          text: 'Looking for Spring Boot engineers.',
          truncated: false,
        },
        {
          id: 'notes',
          fileName: 'unrelated.txt',
          kind: 'additional',
          text: 'Favorite recipes for pasta carbonara and tomato sauce.',
          truncated: false,
        },
      ],
    });
    expect(selected.excerpts.some((doc) => /Kafka/i.test(doc.text))).toBe(true);
    const kafka = selected.excerpts.find((doc) => /Kafka/i.test(doc.text));
    const pasta = selected.excerpts.find((doc) => /carbonara/i.test(doc.text));
    if (pasta && kafka) {
      expect(kafka.relevanceScore).toBeGreaterThan(pasta.relevanceScore);
    }

    const builder = new ContextBuilder({
      idGenerator: () => 'ctx-bound',
    });
    const snapshot = builder.build({
      currentQuestion: q,
      questionHistory: [],
      transcriptSegments: Array.from({ length: 20 }, (_, i) => ({
        id: `t${i}`,
        text: `Transcript segment number ${i} about messaging.`,
        timestamp: Date.now() - i * 1000,
        startTime: Date.now() - i * 1000,
        endTime: Date.now() - i * 1000,
        isFinal: true,
        confidence: 0.9,
      })),
      interviewDocuments: selected,
      budget: {
        ...DEFAULT_CONTEXT_BUDGET,
        maxContextCharacters: 400,
        maxTranscriptSegments: 4,
      },
    });
    expect(snapshot.metadata.characterCount).toBeLessThanOrEqual(500);
    expect(snapshot.interviewDocuments?.excerpts.some((e) => /Kafka/i.test(e.text))).toBe(true);
  });
});

describe('Phase 2K — long session bounded state', () => {
  it('keeps transcript, questions, and context snapshots bounded across 100 questions', () => {
    const transcripts = new TranscriptStore({
      maxFinals: 40,
      idGenerator: (() => {
        let i = 0;
        return () => `seg-${++i}`;
      })(),
    });
    const questions = new QuestionManager({
      idGenerator: (() => {
        let i = 0;
        return () => `q-${++i}`;
      })(),
    });
    questions.setEnabled(true);

    for (let i = 0; i < 100; i += 1) {
      transcripts.commitFinal(`Final transcript ${i} about systems design.`);
      questions.processManualText(`What is concept number ${i}?`);
    }

    expect(transcripts.getRecent().length).toBeLessThanOrEqual(40);
    expect(questions.getRecent().length).toBeLessThanOrEqual(QUESTION_BUFFER.MAX_RECENT_QUESTIONS);

    const engine = new ContextEngine({
      idGenerator: (() => {
        let i = 0;
        return () => `ctx-${++i}`;
      })(),
      getConfig: () => ({
        ...DEFAULT_CONTEXT_PUBLIC_CONFIG,
        budget: { ...DEFAULT_CONTEXT_BUDGET, maxRecentSnapshots: 20 },
      }),
    });
    for (let i = 0; i < 100; i += 1) {
      const q = question({ id: `stress-q-${i}`, text: `Question ${i}?` });
      engine.buildForQuestion({
        question: q,
        questionHistory: questions.getRecent(),
        transcriptSegments: transcripts.getRecent(),
      });
    }
    expect(engine.getRecent(100).length).toBeLessThanOrEqual(20);
  });
});

describe('Phase 2K — error injection recovery', () => {
  it('AI provider failure surfaces without leaving an active request', async () => {
    const q = question({ id: 'q-fail', text: 'What is TypeScript?' });
    const ctx = contextFor(q);
    const failingProvider: AIProvider = {
      connect: async () => undefined,
      disconnect: async () => undefined,
      cancel: async () => undefined,
      getStatus: () => ({
        provider: 'mock',
        connected: true,
        model: 'mock',
        activeRequestId: null,
        lastErrorCode: null,
      }),
      async *generate() {
        yield {
          requestId: 'fail-id',
          sequence: 0,
          text: '',
          isFinal: false,
        };
        throw new Error('simulated provider failure');
      },
    };
    const orchestrator = new AIOrchestrator({
      idGenerator: () => 'fail-id',
      getConfig: () => ({
        ...DEFAULT_AI_PUBLIC_CONFIG,
        provider: 'mock',
        autoGenerate: true,
        model: 'mock',
      }),
      isConfigured: async () => true,
      createProvider: () => failingProvider,
      getQuestion: () => q,
      getContextForQuestion: () => ctx,
    });

    const result = await orchestrator.generate({ question: q, context: ctx, force: true });
    expect(result.status).toBe('error');
    expect(result.error?.message).toBeTruthy();
    expect(result.error?.message).not.toMatch(/stack|ECONN|apiKey|sk-/i);
    const status = await orchestrator.getStatus();
    expect(status.activeRequestId).toBeNull();
  });

  it('visual intelligence failures are non-fatal to interview UI state', async () => {
    const { InterviewHost: Host } = await import('../../src/main/interview/InterviewHost');
    const harness = createInterviewHarness();
    const host = new Host(harness);
    await host.startInterview();

    for (const listener of harness.visualListeners) {
      listener({
        type: 'visual.ocr.failed',
        timestamp: Date.now(),
        code: 'OCR_UNAVAILABLE',
        message: 'OCR engine missing',
      });
      listener({
        type: 'visual.vision.failed',
        timestamp: Date.now(),
        code: 'VISION_TIMEOUT',
        message: 'Vision timed out',
      });
    }

    const status = host.getStatus();
    expect(status.phase).toBe('live');
    expect(status.listening).toBe(true);
    host.dispose();
  });
});

describe('Phase 2L-B — interview execution mode isolation', () => {
  it('real mode enables listening and microphone question ingest', async () => {
    const { InterviewHost: Host } = await import('../../src/main/interview/InterviewHost');
    const harness = createInterviewHarness();
    const host = new Host(harness);
    const status = await host.startInterview();
    expect(status.executionMode).toBe('real');
    expect(status.listening).toBe(true);
    expect(harness.calls.setMicrophoneQuestionIngest.at(-1)).toBe(true);
    host.dispose();
  });

  it('simulation mode disables listening and microphone question ingest', async () => {
    const { InterviewHost: Host } = await import('../../src/main/interview/InterviewHost');
    const harness = createInterviewHarness();
    const host = new Host(harness);
    const status = await host.startInterview({ mode: 'simulation' });
    expect(status.executionMode).toBe('simulation');
    expect(status.listening).toBe(false);
    expect(harness.calls.setMicrophoneQuestionIngest.at(-1)).toBe(false);
    expect(harness.calls.pauseAudio).toBeGreaterThanOrEqual(1);
    host.dispose();
  });

  it('simulation mode rejects manual/microphone-driven questions', async () => {
    const { InterviewHost: Host } = await import('../../src/main/interview/InterviewHost');
    const harness = createInterviewHarness();
    const host = new Host(harness);
    await host.startInterview({ mode: 'simulation' });
    await expect(host.submitManualQuestion('What is Java?')).rejects.toThrow(/simulation/i);
    expect(harness.calls.processManual).toBe(0);
    host.dispose();
  });

  it('submitSimulatedQuestion injects exactly one runtime question', async () => {
    const { InterviewHost: Host } = await import('../../src/main/interview/InterviewHost');
    const harness = createInterviewHarness();
    const host = new Host(harness);
    await host.startInterview({ mode: 'simulation' });
    const first = await host.submitSimulatedQuestion('Can you tell me about yourself?', {
      simulationQuestionId: 'Q01',
    });
    expect(first.runtimeQuestionId).toBeTruthy();
    expect(harness.calls.processSimulated).toBe(1);
    const second = await host.submitSimulatedQuestion('Can you explain your current project?', {
      simulationQuestionId: 'Q02',
    });
    expect(second.runtimeQuestionId).toBeTruthy();
    expect(second.runtimeQuestionId).not.toBe(first.runtimeQuestionId);
    expect(harness.calls.processSimulated).toBe(2);
    host.dispose();
  });

  it('resume in simulation does not re-enable microphone listening', async () => {
    const { InterviewHost: Host } = await import('../../src/main/interview/InterviewHost');
    const harness = createInterviewHarness();
    const host = new Host(harness);
    await host.startInterview({ mode: 'simulation' });
    await host.pauseInterview();
    const status = await host.resumeInterview();
    expect(status.executionMode).toBe('simulation');
    expect(status.listening).toBe(false);
    expect(harness.calls.setMicrophoneQuestionIngest.at(-1)).toBe(false);
    expect(harness.calls.resumeAudio).toBe(0);
    host.dispose();
  });

  it('markListeningActive is a no-op in simulation mode', async () => {
    const { InterviewHost: Host } = await import('../../src/main/interview/InterviewHost');
    const harness = createInterviewHarness();
    const host = new Host(harness);
    await host.startInterview({ mode: 'simulation' });
    const status = host.markListeningActive();
    expect(status.listening).toBe(false);
    host.dispose();
  });
});

describe('Phase 2L-B — AudioHost microphone ingest gate', () => {
  it('does not feed Deepgram finals into question detection when ingest is disabled', async () => {
    const { AudioHost } = await import('../../src/main/services/audio/AudioHost');
    const { MockSTTProvider } = await import('../../src/core/stt/MockSTTProvider');
    const stt = new MockSTTProvider();
    const host = new AudioHost({
      stt,
      getAiConfig: () => ({
        ...DEFAULT_AI_PUBLIC_CONFIG,
        provider: 'mock',
        autoGenerate: false,
      }),
    });
    host.setPermission('granted');
    await host.start({ sampleRate: 16000, channels: 1 });
    host.confirmActive();
    host.setQuestionProcessingEnabled(true);
    host.setMicrophoneQuestionIngest(false);

    stt.emitFinalTranscript('What is dependency injection in Spring?');
    await new Promise((r) => setTimeout(r, 20));
    expect(host.getQuestionStatus().questionCount).toBe(0);

    host.setMicrophoneQuestionIngest(true);
    // Distinct text — TranscriptStore suppresses duplicate identical finals.
    stt.emitFinalTranscript('Can you explain how Spring Boot auto-configuration works?');
    await new Promise((r) => setTimeout(r, 20));
    expect(host.getQuestionStatus().questionCount).toBe(1);

    host.dispose();
  });

  it('processSimulatedQuestion still creates questions while mic ingest is off', async () => {
    const { AudioHost } = await import('../../src/main/services/audio/AudioHost');
    const host = new AudioHost({
      getAiConfig: () => ({
        ...DEFAULT_AI_PUBLIC_CONFIG,
        provider: 'mock',
        autoGenerate: false,
      }),
    });
    host.setQuestionProcessingEnabled(true);
    host.setMicrophoneQuestionIngest(false);
    const produced = host.processSimulatedQuestion('Can you tell me about yourself?', {
      simulationQuestionId: 'Q01',
    });
    expect(produced).toHaveLength(1);
    expect(produced[0]?.sourceSegmentIds).toEqual(['simulation']);
    expect(host.getQuestionStatus().questionCount).toBe(1);
    host.dispose();
  });
});

describe('Phase 2K — security regression', () => {
  it('main window keeps isolation and disables nodeIntegration', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/main/windows/createMainWindow.ts'),
      'utf8',
    );
    expect(source).toMatch(/contextIsolation:\s*true/);
    expect(source).toMatch(/nodeIntegration:\s*false/);
    expect(source).toMatch(/webSecurity:\s*true/);
    expect(source).toMatch(/sandbox:\s*true/);
  });
});
