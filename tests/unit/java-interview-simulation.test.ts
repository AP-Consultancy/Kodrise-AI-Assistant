import { describe, expect, it } from 'vitest';
import { getJavaInterviewDataset } from '../../src/core/simulation/javaInterviewDataset';
import { JavaInterviewSimulationService } from '../../src/core/simulation/JavaInterviewSimulationService';
import { matchJavaInterviewAnswer } from '../../src/core/simulation/matchJavaInterviewAnswer';
import { QuestionManager } from '../../src/core/questions/QuestionManager';
import { MockAIProvider } from '../../src/main/ai/providers/MockAIProvider';
import type { DetectedQuestion } from '../../src/shared/questions/types';
import type { ContextSnapshot } from '../../src/shared/context/types';
import { DEFAULT_CONTEXT_BUDGET } from '../../src/shared/context/types';
import { ContextBuilder } from '../../src/core/context/ContextBuilder';

function question(text: string, id = 'q-test'): DetectedQuestion {
  return {
    id,
    text,
    originalText: text,
    normalizedText: text.toLowerCase(),
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
  };
}

function contextFor(q: DetectedQuestion): ContextSnapshot {
  return {
    id: 'ctx',
    sessionId: 's',
    correlationId: 'c',
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
      characterCount: 10,
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

describe('Phase 2L-B — Java interview dataset', () => {
  const dataset = getJavaInterviewDataset();

  it('contains at least 50 questions', () => {
    expect(dataset.length).toBeGreaterThanOrEqual(50);
    expect(dataset.length).toBe(60);
  });

  it('every question has required fields', () => {
    for (const item of dataset) {
      expect(item.id).toMatch(/^Q\d{2}$/);
      expect(item.interviewerQuestion.trim().length).toBeGreaterThan(0);
      expect(item.mockAnswer.trim().length).toBeGreaterThan(0);
      expect(item.keyPoints.length).toBeGreaterThan(0);
    }
  });
});

describe('Phase 2L-B — simulation isolation from STT/dedupe', () => {
  it('simulation questions skip duplicate detection', () => {
    let n = 0;
    const manager = new QuestionManager({ idGenerator: () => `rt-${++n}` });
    const first = manager.processSimulatedText('What is Spring Boot?', {
      simulationQuestionId: 'Q26',
      expectedType: 'backend',
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.sourceSegmentIds).toEqual(['simulation']);

    // Same text again — still creates a new runtime question (no dedupe).
    const second = manager.processSimulatedText('What is Spring Boot?', {
      simulationQuestionId: 'Q26',
      expectedType: 'backend',
    });
    expect(second).toHaveLength(1);
    expect(second[0]?.id).not.toBe(first[0]?.id);
    expect(manager.getRecent().length).toBe(2);
  });

  it('microphone finals still use duplicate detection in real path', () => {
    let n = 0;
    const manager = new QuestionManager({ idGenerator: () => `rt-${++n}` });
    const now = Date.now();
    manager.processFinalSegment({
      id: 'a',
      text: 'What is Spring Boot?',
      timestamp: now,
      startTime: now,
      endTime: now,
      isFinal: true,
      confidence: 0.9,
    });
    const again = manager.processFinalSegment({
      id: 'b',
      text: 'What is Spring Boot?',
      timestamp: now + 100,
      startTime: now + 100,
      endTime: now + 100,
      isFinal: true,
      confidence: 0.9,
    });
    expect(again).toHaveLength(0);
    expect(manager.getRecent()).toHaveLength(1);
  });

  it('follow-up simulation questions retain parent relationship for context', () => {
    let n = 0;
    const manager = new QuestionManager({ idGenerator: () => `rt-${++n}` });
    const parent = manager.processSimulatedText('What is dependency injection?', {
      simulationQuestionId: 'Q27',
      expectedType: 'backend',
    })[0]!;
    const follow = manager.processSimulatedText('Why do you prefer constructor injection?', {
      simulationQuestionId: 'Q27-followup',
      expectedType: 'backend',
      isFollowUp: true,
      parentQuestionId: parent.id,
    })[0]!;
    expect(follow.parentQuestionId).toBe(parent.id);
    expect(follow.relatedQuestionId).toBe(parent.id);

    const snapshot = new ContextBuilder({ idGenerator: () => 'ctx-sim' }).build({
      currentQuestion: follow,
      questionHistory: manager.getRecent(),
      transcriptSegments: [],
    });
    expect(snapshot.relatedQuestions.some((q) => q.id === parent.id) || snapshot.recentQuestions.length > 0).toBe(
      true,
    );
  });
});

describe('Phase 2L-B — simulation service lifecycle', () => {
  it('starts at Q01 and defaults autoAdvance to false', () => {
    const service = new JavaInterviewSimulationService();
    const started = service.startSimulation();
    expect(started.simulationQuestionId).toBe('Q01');
    expect(started.currentQuestion).toMatch(/tell me about yourself/i);
    expect(started.config.autoAdvance).toBe(false);
    expect(started.progress.currentIndex).toBe(1);
  });

  it('nextQuestion advances exactly once per call', () => {
    const service = new JavaInterviewSimulationService();
    service.startSimulation();
    service.markQuestionAsked('rt-1');
    service.submitAnswer();
    service.nextQuestion();
    expect(service.getActiveSimulationQuestionId()).toBe('Q02');
    // Locked until the host marks the new question as asked.
    service.nextQuestion();
    expect(service.getActiveSimulationQuestionId()).toBe('Q02');
    service.markQuestionAsked('rt-2');
    service.submitAnswer();
    service.nextQuestion();
    expect(service.getActiveSimulationQuestionId()).toBe('Q03');
  });

  it('rapid double next cannot skip a question', () => {
    const service = new JavaInterviewSimulationService();
    service.startSimulation();
    service.markQuestionAsked('rt-1');
    service.submitAnswer();
    service.nextQuestion();
    service.nextQuestion();
    service.nextQuestion();
    expect(service.getActiveSimulationQuestionId()).toBe('Q02');
  });

  it('cannot exceed final question', () => {
    const service = new JavaInterviewSimulationService();
    service.startSimulation();
    for (let i = 0; i < 300; i += 1) {
      service.markQuestionAsked(`rt-${i}`);
      service.submitAnswer();
      service.nextQuestion();
      if (service.getProgress().interviewCompleted) break;
    }
    expect(service.getProgress().interviewCompleted).toBe(true);
    const idx = service.getProgress().currentQuestionIndex;
    service.nextQuestion();
    expect(service.getProgress().currentQuestionIndex).toBe(idx);
  });

  it('reset returns to Q01', () => {
    const service = new JavaInterviewSimulationService();
    service.startSimulation();
    service.markQuestionAsked('rt-1');
    service.submitAnswer();
    service.nextQuestion();
    service.markQuestionAsked('rt-2');
    service.submitAnswer();
    service.nextQuestion();
    const reset = service.resetSimulation();
    expect(reset.simulationQuestionId).toBe('Q01');
    expect(reset.config.autoAdvance).toBe(false);
  });

  it('pause prevents autoAdvance scheduling flag while resume keeps autoAdvance config', () => {
    const service = new JavaInterviewSimulationService();
    service.startSimulation();
    service.updateConfig({ autoAdvance: true });
    expect(service.pause().paused).toBe(true);
    expect(service.getConfig().autoAdvance).toBe(true);
    expect(service.resume().paused).toBe(false);
    expect(service.getConfig().autoAdvance).toBe(true);
  });
});

describe('Phase 2L-B — MockAI simulation answers', () => {
  it('returns dataset answer for Q01 and streams chunks', async () => {
    const provider = new MockAIProvider({ chunkDelayMs: 1 });
    await provider.connect();
    const q = question('Can you tell me about yourself?', 'rt-q01');
    const chunks: string[] = [];
    for await (const chunk of provider.generate({
      requestId: 'r1',
      sessionId: 's',
      correlationId: 'c',
      question: q,
      context: contextFor(q),
      responseMode: 'normal',
      messages: [],
      metadata: {
        model: 'mock',
        temperature: 0.2,
        maxOutputTokens: 400,
        responseMode: 'normal',
        provider: 'mock',
        contextId: 'ctx',
        questionId: q.id,
      },
    })) {
      if (chunk.text) chunks.push(chunk.text);
    }
    const text = chunks.join('');
    expect(chunks.length).toBeGreaterThan(1);
    expect(text.toLowerCase()).toContain('3 years');
    expect(text).not.toMatch(/^Normal answer for:/);
  });

  it('falls back for unknown questions', async () => {
    const provider = new MockAIProvider({ chunkDelayMs: 1 });
    await provider.connect();
    const q = question('What is the capital of Mars in 2099?');
    const chunks: string[] = [];
    for await (const chunk of provider.generate({
      requestId: 'r2',
      sessionId: 's',
      correlationId: 'c',
      question: q,
      context: contextFor(q),
      responseMode: 'normal',
      messages: [],
      metadata: {
        model: 'mock',
        temperature: 0.2,
        maxOutputTokens: 200,
        responseMode: 'normal',
        provider: 'mock',
        contextId: 'ctx',
        questionId: q.id,
      },
    })) {
      if (chunk.text) chunks.push(chunk.text);
    }
    expect(chunks.join('')).toMatch(/Normal answer for:/);
  });

  it('match helper is deterministic', () => {
    const dataset = getJavaInterviewDataset();
    const a = matchJavaInterviewAnswer('What is Java?', dataset);
    const b = matchJavaInterviewAnswer('what is java?', dataset);
    expect(a?.answer).toBe(b?.answer);
  });
});
