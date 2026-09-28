import type {
  CapturedQuestion,
} from '../../shared/question-capture/types';
import type {
  ProgrammingLanguage,
  ProblemType,
  SqlDialect,
} from '../../shared/problem-intelligence/types';
import { ProblemClassifier } from '../problem-intelligence/ProblemClassifier';
import { ProblemExtractor } from '../problem-intelligence/ProblemExtractor';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';

export interface ExtractCapturedQuestionInput {
  frameId: string | null;
  ocrText: string | null;
  visionText: string | null;
  visionDescription: string | null;
  previousCleanedText?: string | null;
}

/**
 * Turn OCR/Vision text into a structured CapturedQuestion.
 * Does not invent missing requirements.
 */
export class CapturedQuestionExtractor {
  private readonly classifier = new ProblemClassifier();
  private readonly extractor = new ProblemExtractor();
  private readonly createId: IdGenerator;

  constructor(options?: { idGenerator?: IdGenerator }) {
    this.createId = options?.idGenerator ?? createDefaultIdGenerator();
  }

  extract(input: ExtractCapturedQuestionInput): CapturedQuestion {
    const warnings: string[] = [];
    const ocr = (input.ocrText ?? '').trim();
    const vision = (input.visionText ?? '').trim();
    const description = (input.visionDescription ?? '').trim();

    let extractedText = ocr;
    let confidence = ocr.length > 40 ? 0.85 : ocr.length > 10 ? 0.65 : 0.3;

    if (!extractedText && vision) {
      extractedText = vision;
      confidence = 0.7;
      warnings.push('OCR unavailable — used vision text.');
    } else if (!extractedText && description) {
      extractedText = description;
      confidence = 0.45;
      warnings.push('OCR unavailable — used vision description.');
    }

    if (!extractedText) {
      return {
        id: this.createId(),
        frameId: input.frameId,
        extractedText: '',
        cleanedText: '',
        detectedQuestionType: 'unknown',
        detectedLanguage: 'unknown',
        detectedSqlDialect: 'unknown',
        detectedCode: null,
        detectedConstraints: [],
        detectedExamples: [],
        confidence: 0,
        warnings: [
          'Unable to read the question clearly. Please capture a larger or clearer region.',
        ],
        isFollowUp: false,
        isIncomplete: true,
        multipleQuestions: [],
        createdAt: Date.now(),
      };
    }

    if (confidence < 0.55) {
      warnings.push('Some text could not be read confidently.');
    }

    const cleanedText = this.clean(extractedText);
    const multipleQuestions = this.splitMultipleQuestions(cleanedText);
    const primary =
      multipleQuestions.length > 1 ? multipleQuestions[0]! : cleanedText;

    const type = this.classifier.classify(primary);
    const language = this.classifier.detectLanguage(primary) ?? 'unknown';
    const sqlDialect = this.classifier.detectSqlDialect(primary) ?? 'unknown';
    const { normalized, warnings: extractWarnings } = this.extractor.extract({
      text: primary,
      language,
      sqlDialect,
    });
    warnings.push(...extractWarnings);

    const isIncomplete = this.looksIncomplete(primary);
    if (isIncomplete) {
      warnings.push('Question may be incomplete.');
    }

    const isFollowUp = this.isFollowUp(primary, input.previousCleanedText ?? null);

    return {
      id: this.createId(),
      frameId: input.frameId,
      extractedText,
      cleanedText: primary,
      detectedQuestionType: type as ProblemType,
      detectedLanguage: language as ProgrammingLanguage,
      detectedSqlDialect: sqlDialect as SqlDialect,
      detectedCode: normalized.existingCode,
      detectedConstraints: normalized.constraints,
      detectedExamples: normalized.examples,
      confidence,
      warnings: [...new Set(warnings)],
      isFollowUp,
      isIncomplete,
      multipleQuestions: multipleQuestions.length > 1 ? multipleQuestions : [],
      createdAt: Date.now(),
    };
  }

  private clean(text: string): string {
    return text
      .split('')
      .filter((ch) => ch.charCodeAt(0) !== 0)
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private splitMultipleQuestions(text: string): string[] {
    const numbered = text.split(/\n(?=\s*\d+[.)]\s+)/).map((s) => s.trim()).filter(Boolean);
    if (numbered.length >= 2) return numbered.slice(0, 8);
    const qmarks = text.split(/(?<=\?)\s+/).map((s) => s.trim()).filter((s) => s.length > 12);
    if (qmarks.length >= 2 && qmarks.every((s) => /\?/.test(s))) return qmarks.slice(0, 8);
    return [text];
  }

  private looksIncomplete(text: string): boolean {
    if (text.length < 24) return true;
    if (/\.\.\.$|…$/.test(text.trim())) return true;
    if (/^(write|implement|given|design)\b/i.test(text) && text.length < 40) return true;
    return false;
  }

  private isFollowUp(text: string, previous: string | null): boolean {
    if (!previous) return false;
    if (
      /^(now |can you |could you |what about |without |assume |make it |use |don't |do not )/i.test(
        text.trim(),
      )
    ) {
      return true;
    }
    if (/without extra space|o\(log n\)|thread-safe|sorted|hashmap|10 million/i.test(text)) {
      return text.length < Math.max(80, previous.length * 0.6);
    }
    return false;
  }
}
