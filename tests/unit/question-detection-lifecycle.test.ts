import { describe, expect, it } from 'vitest';
import { QuestionManager } from '../../src/core/questions/QuestionManager';
import { QuestionDetector } from '../../src/core/questions/QuestionDetector';
import { QuestionClassifier } from '../../src/core/questions/QuestionClassifier';
import { QuestionDuplicateDetector } from '../../src/core/questions/QuestionDuplicateDetector';
import { QuestionTranscriptBuffer } from '../../src/core/questions/QuestionTranscriptBuffer';
import { DETECTION_CONFIDENCE } from '../../src/shared/questions/types';

function segment(text: string, id: string, timestamp = Date.now()) {
  return {
    id,
    text,
    timestamp,
    startTime: timestamp,
    endTime: timestamp,
    isFinal: true as const,
    confidence: 0.9,
  };
}

describe('Phase 2L-A — single spoken question', () => {
  it('detects exactly one question for "Can you tell me what Java is?"', () => {
    let n = 0;
    const manager = new QuestionManager({ idGenerator: () => `q-${++n}` });
    const produced = manager.processFinalSegment(
      segment('Can you tell me what Java is?', 's1'),
    );
    expect(produced).toHaveLength(1);
    expect(manager.getRecent()).toHaveLength(1);
    expect(produced[0]?.detectionConfidence).toBeGreaterThanOrEqual(
      DETECTION_CONFIDENCE.LIKELY_QUESTION,
    );
  });
});

describe('Phase 2L-A — multi-part / related questions', () => {
  it('handles Java vs JavaScript multi-part according to existing detector', () => {
    const detector = new QuestionDetector();
    const hits = detector.detect(
      'Can you tell me what Java is? And how is it different from JavaScript?',
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
    if (hits.length === 1) {
      expect(hits[0]?.isMultiPart || hits[0]?.text.includes('JavaScript')).toBeTruthy();
    } else {
      expect(hits.length).toBe(2);
    }
  });
});

describe('Phase 2L-A — duplicate / progressive STT', () => {
  it('ignores repeated final transcript of the same question', () => {
    let n = 0;
    const manager = new QuestionManager({ idGenerator: () => `q-${++n}` });
    const t0 = Date.now();
    manager.processFinalSegment(segment('Can you explain Spring Boot?', 'a', t0));
    const again = manager.processFinalSegment(
      segment('Can you explain Spring Boot?', 'b', t0 + 500),
    );
    expect(again).toHaveLength(0);
    expect(manager.getRecent()).toHaveLength(1);
  });

  it('collapses progressive STT extensions into one question', () => {
    let n = 0;
    const events: string[] = [];
    const manager = new QuestionManager({
      idGenerator: () => `q-${++n}`,
    });
    manager.subscribe((event) => events.push(event.type));

    const t0 = Date.now();
    const first = manager.processFinalSegment(
      segment('Can you tell me what Java?', 'p1', t0),
    );
    expect(first).toHaveLength(1);

    const second = manager.processFinalSegment(
      segment('Can you tell me what Java is?', 'p2', t0 + 400),
    );
    // Extension updates existing question — does not produce a second classified question.
    expect(second).toHaveLength(0);
    expect(manager.getRecent()).toHaveLength(1);
    expect(manager.getCurrent()?.normalizedText.toLowerCase()).toMatch(/java is/i);
    expect(events.filter((type) => type === 'question.classified')).toHaveLength(1);
    expect(events).toContain('question.updated');
  });

  it('detects prefix/extension relations in the duplicate detector', () => {
    const dup = new QuestionDuplicateDetector();
    expect(
      dup.prefixRelation(
        'Can you tell me what Java is?',
        'Can you tell me what Java',
      ),
    ).toBe('extension');
    expect(
      dup.prefixRelation(
        'Can you tell me what Java',
        'Can you tell me what Java is?',
      ),
    ).toBe('prefix');
    expect(
      dup.prefixRelation('Can you explain Spring Boot?', 'Can you tell me what Java is?'),
    ).toBeNull();
  });
});

describe('Phase 2L-A — two separate questions', () => {
  it('allows a second distinct question after the first', () => {
    let n = 0;
    const manager = new QuestionManager({ idGenerator: () => `q-${++n}` });
    const t0 = Date.now();
    manager.processFinalSegment(segment('Can you tell me what Java is?', 's1', t0));
    const second = manager.processFinalSegment(
      segment('Can you explain Spring Boot?', 's2', t0 + 5_000),
    );
    expect(second).toHaveLength(1);
    expect(manager.getRecent()).toHaveLength(2);
  });
});

describe('Phase 2L-A — question followed by answer', () => {
  it('does not treat explanatory statements as questions', () => {
    let n = 0;
    const manager = new QuestionManager({ idGenerator: () => `q-${++n}` });
    const t0 = Date.now();
    const first = manager.processFinalSegment(
      segment('Can you tell me what Java is?', 's1', t0),
    );
    expect(first).toHaveLength(1);

    const second = manager.processFinalSegment(
      segment('Java is a programming language used for backend services.', 's2', t0 + 2_000),
    );
    expect(second).toHaveLength(0);
    expect(manager.getRecent()).toHaveLength(1);
  });
});
describe('Phase 2L-A — silence / no extra events', () => {
  it('produces no questions when no new finals arrive', () => {
    let n = 0;
    const manager = new QuestionManager({ idGenerator: () => `q-${++n}` });
    manager.processFinalSegment(segment('Can you explain Spring Boot?', 's1'));
    expect(manager.flush()).toHaveLength(0);
    expect(manager.getRecent()).toHaveLength(1);
  });
});

describe('Phase 2L-A — buffer / partial completeness', () => {
  it('does not flush short progressive stems without punctuation', () => {
    const buffer = new QuestionTranscriptBuffer();
    const ready = buffer.push(segment('Can you tell me what', 'early', 1_000));
    expect(ready).toHaveLength(0);
    const complete = buffer.push(segment('Can you tell me what Java is?', 'done', 1_200));
    expect(complete.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 2L-A — classification', () => {
  it('classifies definitional Java question as technical (not unknown)', () => {
    const classifier = new QuestionClassifier();
    const result = classifier.classify('Can you tell me what Java is?');
    expect(result.type).toBe('technical');
    expect(result.classificationConfidence).toBeGreaterThanOrEqual(0.7);
  });

  it('still returns unknown for non-question noise without signals', () => {
    const classifier = new QuestionClassifier();
    const result = classifier.classify('Hello there friend');
    expect(result.type).toBe('unknown');
    expect(result.classificationConfidence).toBe(0.35);
  });
});

describe('Phase 2L-A — reconnect does not invent questions', () => {
  it('session stop then re-enable starts clean without leftover detections', () => {
    let n = 0;
    const manager = new QuestionManager({ idGenerator: () => `q-${++n}` });
    manager.processFinalSegment(segment('Can you tell me what Java is?', 's1'));
    manager.resetForSessionStop();
    expect(manager.getRecent()).toHaveLength(0);
    manager.setEnabled(true);
    expect(manager.processFinalSegment(segment('Can you explain Spring Boot?', 's2'))).toHaveLength(
      1,
    );
  });
});
