import { describe, expect, it, vi } from 'vitest';
import { HotkeyValidator } from '../../src/core/question-capture/HotkeyValidator';
import { CapturedQuestionExtractor } from '../../src/core/question-capture/CapturedQuestionExtractor';
import { QuestionCaptureSession } from '../../src/core/question-capture/QuestionCaptureSession';
import { QuestionCaptureUpdateSchema } from '../../src/shared/ipc/schemas';
import { parsePublicConfig } from '../../src/core/configuration/schema';
import {
  DEFAULT_PUBLIC_CONFIG,
  DEFAULT_QUESTION_CAPTURE_CONFIG,
} from '../../src/shared/config/types';

describe('HotkeyValidator', () => {
  const validator = new HotkeyValidator();

  it('accepts and normalizes a valid hotkey', () => {
    const result = validator.parse('Ctrl+Shift+Q');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized).toBe('CommandOrControl+Shift+Q');
    }
  });

  it('rejects invalid hotkeys (conflict-like empty / incomplete)', () => {
    expect(validator.parse('').ok).toBe(false);
    expect(validator.parse('Q').ok).toBe(false);
    expect(validator.parse('Ctrl+').ok).toBe(false);
  });
});

describe('CapturedQuestionExtractor', () => {
  const extractor = new CapturedQuestionExtractor({
    idGenerator: (() => {
      let n = 0;
      return () => `cq-${++n}`;
    })(),
  });

  it('classifies coding from OCR text', () => {
    const result = extractor.extract({
      frameId: 'f1',
      ocrText: 'Write a function to reverse a linked list. Implement it in Java.',
      visionText: null,
      visionDescription: null,
    });
    expect(result.detectedQuestionType).toBe('coding');
    expect(result.detectedLanguage).toBe('java');
    expect(result.cleanedText.length).toBeGreaterThan(10);
  });

  it('classifies SQL', () => {
    const result = extractor.extract({
      frameId: 'f2',
      ocrText: 'Write a SQL query with JOIN and GROUP BY on Employees',
      visionText: null,
      visionDescription: null,
    });
    expect(result.detectedQuestionType).toBe('sql');
  });

  it('classifies code-output', () => {
    const result = extractor.extract({
      frameId: 'f3',
      ocrText: 'What will this Java code print?\nSystem.out.println(1);',
      visionText: null,
      visionDescription: null,
    });
    expect(result.detectedQuestionType).toBe('code_output');
  });

  it('classifies debugging', () => {
    const result = extractor.extract({
      frameId: 'f4',
      ocrText: 'Find the bug in this code. Why does this fail with a NullPointerException?',
      visionText: null,
      visionDescription: null,
    });
    expect(result.detectedQuestionType).toBe('debugging');
  });

  it('classifies system design', () => {
    const result = extractor.extract({
      frameId: 'f5',
      ocrText: 'Design a scalable URL shortener.',
      visionText: null,
      visionDescription: null,
    });
    expect(result.detectedQuestionType).toBe('system_design');
  });

  it('extracts language override from text', () => {
    const result = extractor.extract({
      frameId: 'f6',
      ocrText: "Given an array of integers, find two numbers that sum to target. I'll use Python.",
      visionText: null,
      visionDescription: null,
    });
    expect(result.detectedLanguage).toBe('python');
  });

  it('extracts SQL dialect', () => {
    const result = extractor.extract({
      frameId: 'f7',
      ocrText: 'Use SQL Server. Write a query to return the top 5 employees.',
      visionText: null,
      visionDescription: null,
    });
    expect(result.detectedSqlDialect).toBe('sqlserver');
  });

  it('detects follow-up constraints', () => {
    const result = extractor.extract({
      frameId: 'f8',
      ocrText: 'Can you do it without extra space?',
      visionText: null,
      visionDescription: null,
      previousCleanedText: 'Find duplicate numbers in an array.',
    });
    expect(result.isFollowUp).toBe(true);
  });

  it('flags incomplete / low confidence OCR', () => {
    const result = extractor.extract({
      frameId: 'f9',
      ocrText: 'Write',
      visionText: null,
      visionDescription: null,
    });
    expect(result.isIncomplete).toBe(true);
    expect(result.warnings.some((w) => /incomplete|confident/i.test(w))).toBe(true);
  });

  it('detects multiple questions', () => {
    const result = extractor.extract({
      frameId: 'f10',
      ocrText: '1) What is polymorphism?\n2) Explain encapsulation.\n3) What is inheritance?',
      visionText: null,
      visionDescription: null,
    });
    expect(result.multipleQuestions.length).toBeGreaterThan(1);
  });

  it('uses vision fallback when OCR fails', () => {
    const result = extractor.extract({
      frameId: 'f11',
      ocrText: null,
      visionText: 'Implement binary search in JavaScript.',
      visionDescription: null,
    });
    expect(result.cleanedText).toMatch(/binary search/i);
    expect(result.warnings.some((w) => /vision/i.test(w))).toBe(true);
  });

  it('returns friendly failure when both OCR and vision fail', () => {
    const result = extractor.extract({
      frameId: 'f12',
      ocrText: null,
      visionText: null,
      visionDescription: null,
    });
    expect(result.cleanedText).toBe('');
    expect(result.warnings[0]).toMatch(/unable to read/i);
  });
});

describe('QuestionCaptureSession', () => {
  it('bounds history and supports reset', () => {
    const session = new QuestionCaptureSession();
    for (let i = 0; i < 40; i += 1) {
      session.push({
        id: `id-${i}`,
        frameId: null,
        extractedText: `q${i}`,
        cleanedText: `q${i}`,
        detectedQuestionType: 'coding',
        detectedLanguage: 'python',
        detectedSqlDialect: 'unknown',
        detectedCode: null,
        detectedConstraints: [],
        detectedExamples: [],
        confidence: 1,
        warnings: [],
        isFollowUp: false,
        isIncomplete: false,
        multipleQuestions: [],
        createdAt: Date.now(),
      });
    }
    expect(session.list().length).toBeLessThanOrEqual(30);
    session.reset();
    expect(session.list()).toHaveLength(0);
  });
});

describe('questionCapture config', () => {
  it('defaults hotkey and region mode', () => {
    expect(DEFAULT_QUESTION_CAPTURE_CONFIG.hotkey).toBe('CommandOrControl+Shift+Q');
    expect(DEFAULT_QUESTION_CAPTURE_CONFIG.captureMode).toBe('region');
  });

  it('merges questionCapture into legacy configs', () => {
    const { questionCapture: _omit, ...legacy } = DEFAULT_PUBLIC_CONFIG;
    const parsed = parsePublicConfig(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.questionCapture.hotkey).toBe('CommandOrControl+Shift+Q');
    }
  });

  it('accepts config updates via IPC schema', () => {
    const parsed = QuestionCaptureUpdateSchema.safeParse({
      hotkey: 'CommandOrControl+Shift+A',
      captureMode: 'full_screen',
    });
    expect(parsed.success).toBe(true);
  });
});

void vi;
