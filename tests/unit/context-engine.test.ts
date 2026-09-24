import { describe, expect, it } from 'vitest';
import { ContextBuilder } from '../../src/core/context/ContextBuilder';
import { ContextEngine } from '../../src/core/context/ContextEngine';
import { ContextDeduplicator } from '../../src/core/context/ContextDeduplicator';
import type { DetectedQuestion } from '../../src/shared/questions/types';
import type { TranscriptSegment } from '../../src/shared/transcription/types';
import { ContextRecentSchema } from '../../src/shared/ipc/schemas';
import { toSafeErrorPayload, ValidationError } from '../../src/shared/errors';
import { DEFAULT_CONTEXT_BUDGET } from '../../src/shared/context/types';

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
    classificationConfidence: 0.8,
    isMultiPart: false,
    parts: [],
    parentQuestionId: null,
    relatedQuestionId: null,
    ...overrides,
  };
}

function segment(id: string, text: string): TranscriptSegment {
  return {
    id,
    text,
    timestamp: Date.now(),
    startTime: Date.now(),
    endTime: Date.now(),
    isFinal: true,
    confidence: 0.9,
  };
}

describe('Context collection', () => {
  const builder = new ContextBuilder({ idGenerator: () => 'ctx-1' });

  it('includes current question, recent transcript, and recent questions', () => {
    const current = question({ id: 'q3', text: 'Why did you choose PostgreSQL?' });
    const history = [
      question({ id: 'q1', text: 'Tell me about your current project.' }),
      question({ id: 'q2', text: 'How did you design the backend?' }),
      current,
    ];
    const snapshot = builder.build({
      currentQuestion: current,
      questionHistory: history,
      transcriptSegments: [
        segment('t1', 'We used Postgres for relational data.'),
        segment('t2', 'The API is NestJS based.'),
      ],
    });

    expect(snapshot.currentQuestion.id).toBe('q3');
    expect(snapshot.recentTranscript.length).toBeGreaterThan(0);
    expect(snapshot.recentQuestions.some((item) => item.id === 'q1' || item.id === 'q2')).toBe(true);
  });

  it('includes parent/follow-up relationship context', () => {
    const parent = question({ id: 'q1', text: 'How did you authenticate users?' });
    const current = question({
      id: 'q2',
      text: 'Why did you choose JWT?',
      parentQuestionId: 'q1',
      relatedQuestionId: 'q1',
      type: 'follow_up',
    });
    const snapshot = builder.build({
      currentQuestion: current,
      questionHistory: [parent, current],
      transcriptSegments: [segment('t1', 'We used JWT tokens.')],
    });
    expect(snapshot.relatedQuestions.some((item) => item.id === 'q1')).toBe(true);
    expect(snapshot.quality.relationshipCoverage).toBe(1);
  });

  it('preserves multi-part question details', () => {
    const current = question({
      id: 'q1',
      text: 'How did you design the API, how did you authenticate users, and how did you handle errors?',
      isMultiPart: true,
      parts: ['How did you design the API', 'how did you authenticate users', 'how did you handle errors'],
      type: 'multi_part',
    });
    const snapshot = builder.build({
      currentQuestion: current,
      questionHistory: [current],
      transcriptSegments: [],
    });
    expect(snapshot.currentQuestion.isMultiPart).toBe(true);
    expect(snapshot.currentQuestion.parts).toHaveLength(3);
  });

  it('includes optional user and project context', () => {
    const snapshot = builder.build({
      currentQuestion: question({ id: 'q1', text: 'What is your role?' }),
      questionHistory: [],
      transcriptSegments: [],
      userContext: { role: 'Senior Engineer', skills: ['TypeScript'] },
      projectContext: { projectName: 'AP Assistant', technologies: ['Electron'] },
    });
    expect(snapshot.userContext?.role).toBe('Senior Engineer');
    expect(snapshot.projectContext?.projectName).toBe('AP Assistant');
    expect(snapshot.metadata.sources).toContain('user_context');
    expect(snapshot.metadata.sources).toContain('project_context');
  });

  it('handles missing optional context', () => {
    const snapshot = builder.build({
      currentQuestion: question({ id: 'q1', text: 'What is caching?' }),
      questionHistory: [],
      transcriptSegments: [],
    });
    expect(snapshot.userContext).toBeNull();
    expect(snapshot.projectContext).toBeNull();
  });
});

describe('Context deduplication and prioritization', () => {
  it('removes duplicate transcript and question text', () => {
    const dedupe = new ContextDeduplicator();
    const segments = dedupe.dedupeTranscript([
      segment('a', 'How did you implement authentication?'),
      segment('b', 'How did you implement authentication?'),
    ]);
    expect(segments).toHaveLength(1);

    const questions = dedupe.dedupeQuestions([
      question({ id: '1', text: 'Same question' }),
      question({ id: '2', text: 'Same question' }),
    ]);
    expect(questions).toHaveLength(1);
  });

  it('keeps current and parent while truncating older context under budget', () => {
    const builder = new ContextBuilder({ idGenerator: () => 'ctx-budget' });
    const parent = question({ id: 'parent', text: 'How did you authenticate users?' });
    const current = question({
      id: 'current',
      text: 'Why JWT?',
      parentQuestionId: 'parent',
      relatedQuestionId: 'parent',
    });
    const history = [
      question({ id: 'old1', text: 'Tell me about yourself.' }),
      question({ id: 'old2', text: 'What is your background?' }),
      parent,
      current,
    ];
    const transcript = Array.from({ length: 20 }, (_, index) =>
      segment(`t${index}`, `Older transcript filler segment number ${index} with extra words.`),
    );

    const snapshot = builder.build({
      currentQuestion: current,
      questionHistory: history,
      transcriptSegments: transcript,
      budget: {
        ...DEFAULT_CONTEXT_BUDGET,
        maxTranscriptSegments: 3,
        maxTranscriptCharacters: 180,
        maxQuestionCount: 1,
        maxContextCharacters: 500,
      },
    });

    expect(snapshot.currentQuestion.id).toBe('current');
    expect(snapshot.relatedQuestions.some((item) => item.id === 'parent')).toBe(true);
    expect(snapshot.metadata.truncated).toBe(true);
    expect(
      snapshot.metadata.omittedTranscriptSegments + snapshot.metadata.omittedQuestions,
    ).toBeGreaterThan(0);
  });
});

describe('Context engine session lifecycle', () => {
  it('builds snapshots and clears on session stop', () => {
    const engine = new ContextEngine({
      idGenerator: () => 'engine-1',
      getConfig: () => ({
        budget: { ...DEFAULT_CONTEXT_BUDGET, maxRecentSnapshots: 5 },
        userContext: {},
        projectContext: {},
      }),
    });

    const q = question({ id: 'q1', text: 'How does caching work?' });
    const snapshot = engine.buildForQuestion({
      question: q,
      transcriptSegments: [segment('t1', 'We use Redis.')],
      questionHistory: [q],
    });
    expect(snapshot?.id).toBe('engine-1');
    expect(engine.getCurrent()?.questionId).toBe('q1');

    engine.resetForSessionStop();
    expect(engine.isEnabled()).toBe(false);
    expect(engine.getCurrent()).toBeNull();
    expect(
      engine.buildForQuestion({
        question: question({ id: 'q2', text: 'Why Redis?' }),
        transcriptSegments: [],
        questionHistory: [],
      }),
    ).toBeNull();
  });

  it('does not inherit previous session snapshots after clear', () => {
    const engine = new ContextEngine({ idGenerator: () => 's1' });
    engine.buildForQuestion({
      question: question({ id: 'q1', text: 'Question one?' }),
      transcriptSegments: [],
      questionHistory: [],
    });
    engine.clear();
    expect(engine.getRecent()).toHaveLength(0);
  });

  it('strips credential-like preference keys from user context', () => {
    const builder = new ContextBuilder({ idGenerator: () => 'safe' });
    const snapshot = builder.build({
      currentQuestion: question({ id: 'q1', text: 'Hello?' }),
      questionHistory: [],
      transcriptSegments: [],
      userContext: {
        role: 'Engineer',
        preferences: { theme: 'dark', apiKey: 'secret', token: 'nope' },
      },
    });
    expect(snapshot.userContext?.preferences?.theme).toBe('dark');
    expect(snapshot.userContext?.preferences?.apiKey).toBeUndefined();
    expect(snapshot.userContext?.preferences?.token).toBeUndefined();
  });
});

describe('Context IPC contracts', () => {
  it('validates recent payload', () => {
    expect(ContextRecentSchema.safeParse({ limit: 5 }).success).toBe(true);
    expect(ContextRecentSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('maps validation errors safely', () => {
    const payload = toSafeErrorPayload(new ValidationError('Invalid context recent payload'));
    expect(payload.code).toBe('VALIDATION');
    expect(JSON.stringify(payload)).not.toMatch(/apiKey|secret/i);
  });
});
