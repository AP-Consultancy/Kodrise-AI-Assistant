import type {
  NormalizedProblem,
  ProgrammingLanguage,
  SqlDialect,
} from '../../shared/problem-intelligence/types';
import { ProblemClassifier } from './ProblemClassifier';

export interface ExtractProblemInput {
  text: string;
  language?: ProgrammingLanguage;
  sqlDialect?: SqlDialect;
  existingCode?: string | null;
  existingSql?: string | null;
  schema?: string | null;
  sampleData?: string | null;
}

/**
 * Normalize raw problem text into structured fields without inventing requirements.
 */
export class ProblemExtractor {
  private readonly classifier = new ProblemClassifier();

  extract(input: ExtractProblemInput): { normalized: NormalizedProblem; warnings: string[] } {
    const originalText = input.text.trim();
    const warnings: string[] = [];
    const ambiguities: string[] = [];

    const constraints = this.extractBulletSection(originalText, /constraints?/i);
    const examples = this.extractExamples(originalText);
    const inputFormat = this.extractLabeled(originalText, /input\s*format/i);
    const outputFormat = this.extractLabeled(originalText, /output\s*format/i);
    const title = this.extractTitle(originalText);

    const language =
      input.language && input.language !== 'unknown'
        ? input.language
        : this.classifier.detectLanguage(originalText) ?? 'unknown';

    const sqlDialect =
      input.sqlDialect && input.sqlDialect !== 'unknown'
        ? input.sqlDialect
        : this.classifier.detectSqlDialect(originalText) ?? 'unknown';

    if (!constraints.length && /write|implement|given/i.test(originalText)) {
      warnings.push('Input size constraint was not provided.');
      ambiguities.push('Missing explicit constraints');
    }
    if (language === 'unknown' && /code|function|implement/i.test(originalText)) {
      warnings.push('Programming language was not specified.');
      ambiguities.push('Language unspecified');
    }
    if (sqlDialect === 'unknown' && /\b(select|sql|query)\b/i.test(originalText)) {
      warnings.push('SQL dialect was not specified.');
      ambiguities.push('SQL dialect unspecified');
    }

    const codeBlock = this.extractCodeBlock(originalText);
    const existingCode = input.existingCode ?? codeBlock;
    const existingSql = input.existingSql ?? this.extractSqlBlock(originalText);

    const expectedTask = this.inferTask(originalText);

    return {
      normalized: {
        title,
        statement: originalText,
        originalText,
        constraints,
        inputFormat,
        outputFormat,
        examples,
        existingCode,
        existingSql,
        language,
        sqlDialect,
        expectedTask,
        ambiguities,
        schema: input.schema ?? null,
        sampleData: input.sampleData ?? null,
      },
      warnings,
    };
  }

  private extractTitle(text: string): string | null {
    const first = text.split(/\n/)[0]?.trim() ?? '';
    if (first.length > 0 && first.length <= 120 && !/[.?!]$/.test(first)) {
      return first;
    }
    return null;
  }

  private extractBulletSection(text: string, heading: RegExp): string[] {
    const lines = text.split(/\r?\n/);
    const out: string[] = [];
    let inSection = false;
    for (const line of lines) {
      if (heading.test(line) && /:/.test(line)) {
        inSection = true;
        continue;
      }
      if (inSection) {
        if (/^[A-Za-z].*:$/.test(line.trim()) && !/^[-*•]/.test(line.trim())) break;
        const cleaned = line.replace(/^[-*•]\s*/, '').trim();
        if (cleaned) out.push(cleaned);
      }
    }
    return out;
  }

  private extractLabeled(text: string, label: RegExp): string | null {
    const match = text.match(new RegExp(`${label.source}\\s*:?\\s*([^\\n]+)`, 'i'));
    return match?.[1]?.trim() || null;
  }

  private extractExamples(text: string): string[] {
    const examples: string[] = [];
    const re = /example\s*\d*\s*[:-]\s*([\s\S]*?)(?=example\s*\d*\s*[:-]|$)/gi;

    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const chunk = m[1]?.trim();
      if (chunk) examples.push(chunk.slice(0, 2000));
    }
    return examples.slice(0, 10);
  }

  private extractCodeBlock(text: string): string | null {
    const fenced = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
    return fenced?.[1]?.trim() || null;
  }

  private extractSqlBlock(text: string): string | null {
    const fenced = text.match(/```sql\n([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();
    const select = text.match(/\b(SELECT[\s\S]+?;)/i);
    return select?.[1]?.trim() || null;
  }

  private inferTask(text: string): string | null {
    if (/what will|what is the output|predict the output/i.test(text)) return 'predict_output';
    if (/fix|bug|debug/i.test(text)) return 'debug';
    if (/write|implement|create/i.test(text)) return 'implement';
    if (/design|architect/i.test(text)) return 'design';
    if (/explain|describe|compare/i.test(text)) return 'explain';
    return null;
  }
}
