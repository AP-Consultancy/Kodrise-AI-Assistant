import type {
  NormalizedProblem,
  ProblemTestCase,
  ProblemType,
} from '../../shared/problem-intelligence/types';
import type { IdGenerator } from '../../shared/session/types';
import { createDefaultIdGenerator } from '../../shared/session/types';

/**
 * Structured test-case generation for coding problems.
 */
export class TestCaseGenerator {
  private readonly createId: IdGenerator;
  private readonly maxTests: number;

  constructor(options?: { idGenerator?: IdGenerator; maxTests?: number }) {
    this.createId = options?.idGenerator ?? createDefaultIdGenerator();
    this.maxTests = options?.maxTests ?? 50;
  }

  generate(input: {
    type: ProblemType;
    normalized: NormalizedProblem;
    aiTests?: Array<{ input: string; expectedOutput: string; description: string }>;
  }): ProblemTestCase[] {
    if (
      input.type !== 'coding' &&
      input.type !== 'algorithm' &&
      input.type !== 'debugging' &&
      input.type !== 'code_output'
    ) {
      return [];
    }

    const fromAi = (input.aiTests ?? []).map((t) => ({
      id: this.createId(),
      input: t.input,
      expectedOutput: t.expectedOutput,
      description: t.description,
    }));

    const defaults: ProblemTestCase[] = [
      {
        id: this.createId(),
        input: '[]',
        expectedOutput: '[]',
        description: 'Empty input where valid',
      },
      {
        id: this.createId(),
        input: '[1]',
        expectedOutput: '[1]',
        description: 'Minimum / single-element case',
      },
      {
        id: this.createId(),
        input: '[1, 2, 3]',
        expectedOutput: '[1, 2, 3]',
        description: 'Normal case',
      },
      {
        id: this.createId(),
        input: '[1, 1, 2, 2]',
        expectedOutput: '[1, 2]',
        description: 'Duplicate values',
      },
      {
        id: this.createId(),
        input: '[-3, -1, 0, 2]',
        expectedOutput: 'depends on problem',
        description: 'Negative values where relevant',
      },
    ];

    // Prefer example-derived tests from problem statement
    const fromExamples = input.normalized.examples.slice(0, 5).map((ex, i) => ({
      id: this.createId(),
      input: ex.slice(0, 500),
      expectedOutput: 'see example',
      description: `Example ${i + 1} from problem statement`,
    }));

    const merged = [...fromAi, ...fromExamples, ...defaults];
    return merged.slice(0, this.maxTests);
  }
}
