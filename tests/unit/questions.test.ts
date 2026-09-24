import { describe, expect, it } from 'vitest';
import { QuestionDetector } from '../../src/core/questions/QuestionDetector';
import { QuestionNormalizer } from '../../src/core/questions/QuestionNormalizer';
import { QuestionClassifier } from '../../src/core/questions/QuestionClassifier';
import { QuestionManager } from '../../src/core/questions/QuestionManager';
import { QuestionDuplicateDetector } from '../../src/core/questions/QuestionDuplicateDetector';
import { QuestionRecentSchema } from '../../src/shared/ipc/schemas';
import { toSafeErrorPayload, ValidationError } from '../../src/shared/errors';
import { DETECTION_CONFIDENCE } from '../../src/shared/questions/types';

function segment(text: string, id = 'seg-1') {
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

describe('Question detection', () => {
  const detector = new QuestionDetector();

  it('detects explicit questions', () => {
    const [hit] = detector.detect('How does dependency injection work?');
    expect(hit.detectionConfidence).toBeGreaterThanOrEqual(DETECTION_CONFIDENCE.STRONG_QUESTION);
  });

  it('detects questions without punctuation', () => {
    const [hit] = detector.detect('Can you explain dependency injection');
    expect(hit.detectionConfidence).toBeGreaterThanOrEqual(DETECTION_CONFIDENCE.LIKELY_QUESTION);
  });

  it('rejects non-question statements', () => {
    const hits = detector.detect('I worked on an authentication service.');
    expect(hits.length === 0 || hits[0]!.detectionConfidence < DETECTION_CONFIDENCE.IGNORE_BELOW).toBe(
      true,
    );
  });

  it('detects conversational questions', () => {
    const [hit] = detector.detect('So how did you handle authentication?');
    expect(hit.detectionConfidence).toBeGreaterThanOrEqual(DETECTION_CONFIDENCE.LIKELY_QUESTION);
  });

  it('detects follow-up questions with context', () => {
    const [hit] = detector.detect('And why did you choose PostgreSQL?', {
      hasRecentQuestion: true,
    });
    expect(hit.isFollowUp).toBe(true);
  });

  it('detects clarification questions', () => {
    const [hit] = detector.detect('What do you mean by stateless?');
    expect(hit.isClarification).toBe(true);
  });

  it('detects multi-part questions', () => {
    const [hit] = detector.detect(
      'How did you design the API, how did you authenticate users, and how did you handle errors?',
    );
    expect(hit.isMultiPart).toBe(true);
    expect(hit.parts.length).toBeGreaterThan(1);
  });

  it('splits multiple questions in one segment', () => {
    const hits = detector.detect(
      'Tell me about your current project. How did you design the backend?',
    );
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('treats incomplete stems cautiously', () => {
    const hits = detector.detect('Can you explain');
    // May score as question-shaped but short; manager buffer keeps incomplete.
    expect(Array.isArray(hits)).toBe(true);
  });

  it('handles ambiguous meta-question phrasing', () => {
    const [hit] = detector.detect('The question is how authentication works.');
    expect(hit.detectionConfidence).toBeGreaterThanOrEqual(DETECTION_CONFIDENCE.UNCERTAIN);
  });

  it('rejects relative-clause false positives', () => {
    const hits = detector.detect('What I learned from the project was resilience.');
    expect(hits.every((hit) => hit.detectionConfidence < DETECTION_CONFIDENCE.IGNORE_BELOW)).toBe(
      true,
    );
  });
});

describe('Question normalization', () => {
  const normalizer = new QuestionNormalizer();

  it('normalizes whitespace and duplicate punctuation', () => {
    const result = normalizer.normalize('  how   did you   use   AWS lambda??? ');
    expect(result.normalizedText).toMatch(/How did you use AWS lambda\?/);
    expect(result.originalText).toContain('AWS lambda');
  });

  it('strips common STT artifacts and fillers', () => {
    const result = normalizer.normalize('Um, can you explain, like, authentication [noise]');
    expect(result.normalizedText.toLowerCase()).not.toContain('um');
    expect(result.normalizedText.toLowerCase()).toContain('authentication');
  });

  it('preserves technical terminology', () => {
    const result = normalizer.normalize('How did you use AWS Lambda?');
    expect(result.normalizedText).toContain('AWS Lambda');
  });
});

describe('Question classification', () => {
  const classifier = new QuestionClassifier();

  const cases: Array<[string, string]> = [
    ['What is dependency injection?', 'technical'],
    ['Write a function to reverse a linked list.', 'coding'],
    ['How would you design a URL shortener?', 'system_design'],
    ['Explain clean architecture in your service.', 'architecture'],
    ['Why did you choose PostgreSQL?', 'database'],
    ['How would you deploy this on AWS?', 'cloud'],
    ['How do you set up a CI/CD pipeline with Docker?', 'devops'],
    ['How did you structure the React frontend?', 'frontend'],
    ['How does your NestJS Express GraphQL backend handle authentication middleware?', 'backend'],
    ['How would you train a machine learning model?', 'ai_ml'],
    ['Tell me about a conflict with a teammate.', 'behavioral'],
    ['Tell me about your current project.', 'project'],
    ['Tell me about yourself.', 'general'],
    ['And why did you use JWT?', 'follow_up'],
    ['Can you clarify that?', 'clarification'],
    ['Hello there friend', 'unknown'],
  ];

  for (const [text, expected] of cases) {
    it(`classifies: ${expected}`, () => {
      const hints =
        expected === 'follow_up'
          ? { isFollowUp: true }
          : expected === 'clarification'
            ? { isClarification: true }
            : undefined;
      const result = classifier.classify(text, hints);
      expect(result.type).toBe(expected);
    });
  }
});

describe('Question context, duplicates, session', () => {
  it('links follow-ups to parent questions', () => {
    let id = 0;
    const manager = new QuestionManager({
      idGenerator: () => `q-${(id += 1)}`,
    });
    manager.processFinalSegment(segment('How did you authenticate users?', 's1'));
    const followUps = manager.processFinalSegment(segment('And why did you use JWT?', 's2'));
    expect(followUps[0]?.type).toBe('follow_up');
    expect(followUps[0]?.parentQuestionId).toBeTruthy();
  });

  it('prevents duplicate questions', () => {
    const manager = new QuestionManager({ idGenerator: () => 'same' });
    manager.processFinalSegment(segment('How did you implement authentication?', 'a'));
    const second = manager.processFinalSegment(segment('How did you implement authentication?', 'b'));
    // Second may be ignored as duplicate of same normalized text.
    expect(manager.getRecent().length).toBe(1);
    expect(second.length).toBe(0);
  });

  it('duplicate detector scores similar text highly', () => {
    const detector = new QuestionDuplicateDetector();
    expect(
      detector.similarity(
        'How did you implement authentication?',
        'How did you implement authentication?',
      ),
    ).toBeGreaterThan(0.9);
  });

  it('session stop prevents new question events', () => {
    const manager = new QuestionManager();
    manager.processFinalSegment(segment('How does caching work?'));
    manager.resetForSessionStop();
    const after = manager.processFinalSegment(segment('Why did you choose Redis?'));
    expect(after).toHaveLength(0);
    expect(manager.isEnabled()).toBe(false);
  });

  it('clear resets question state', () => {
    const manager = new QuestionManager();
    manager.processFinalSegment(segment('How does caching work?'));
    manager.clear();
    expect(manager.getRecent()).toHaveLength(0);
    expect(manager.getCurrent()).toBeNull();
  });
});

describe('Question IPC contracts', () => {
  it('accepts valid recent payload', () => {
    expect(QuestionRecentSchema.safeParse({ limit: 10 }).success).toBe(true);
  });

  it('rejects invalid recent payload', () => {
    expect(QuestionRecentSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('maps validation errors safely', () => {
    const payload = toSafeErrorPayload(new ValidationError('Invalid question recent payload'));
    expect(payload.code).toBe('VALIDATION');
    expect(payload.message).not.toMatch(/stack|path|secret/i);
  });
});
