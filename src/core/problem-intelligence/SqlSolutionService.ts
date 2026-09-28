import type { AIProvider } from '../ai/AIProvider';
import type {
  NormalizedProblem,
  ProblemSolutionPayload,
  ProblemType,
  ProgrammingLanguage,
  SqlDialect,
} from '../../shared/problem-intelligence/types';
import { CodeSolutionService } from './CodeSolutionService';

/**
 * SQL-focused solution generation — reuses CodeSolutionService + PromptBuilder path.
 */
export class SqlSolutionService {
  private readonly codeSolutions: CodeSolutionService;

  constructor(options?: { codeSolutions?: CodeSolutionService }) {
    this.codeSolutions = options?.codeSolutions ?? new CodeSolutionService();
  }

  async generate(input: {
    provider: AIProvider;
    type: ProblemType;
    normalized: NormalizedProblem;
    language: ProgrammingLanguage;
    sqlDialect: SqlDialect;
    followUpConstraint?: string | null;
    sessionId?: string | null;
    correlationId?: string | null;
  }): Promise<{
    solution: ProblemSolutionPayload;
    rawText: string;
  }> {
    const parsed = await this.codeSolutions.generate({
      ...input,
      type: input.type === 'unknown' ? 'sql' : input.type,
    });

    const sql =
      parsed.solution.sql ??
      parsed.solution.code ??
      input.normalized.existingSql ??
      'SELECT 1 AS value;';

    return {
      solution: {
        ...parsed.solution,
        sql,
        code: null,
        explanation: parsed.solution.explanation || 'SQL solution generated.',
      },
      rawText: parsed.rawText,
    };
  }
}
