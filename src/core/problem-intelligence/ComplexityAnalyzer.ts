import type {
  ComplexityAnalysis,
  NormalizedProblem,
  ProblemType,
} from '../../shared/problem-intelligence/types';

/**
 * Heuristic complexity estimate tied to generated algorithm text.
 * Does not claim verified complexity.
 */
export class ComplexityAnalyzer {
  analyze(input: {
    type: ProblemType;
    algorithm?: string | null;
    code?: string | null;
    explanation?: string | null;
  }): ComplexityAnalysis {
    const blob = `${input.algorithm ?? ''}\n${input.code ?? ''}\n${input.explanation ?? ''}`.toLowerCase();

    let timeComplexity = 'O(n)';
    let spaceComplexity = 'O(1)';
    let uncertain = true;

    if (/o\(n\s*log\s*n\)|n log n|sort(?:ing)?\b/.test(blob)) {
      timeComplexity = 'O(n log n)';
      uncertain = false;
    } else if (/o\(n\^2\)|o\(n²\)|nested loop|two nested/.test(blob)) {
      timeComplexity = 'O(n²)';
      uncertain = false;
    } else if (/o\(log\s*n\)|binary search/.test(blob)) {
      timeComplexity = 'O(log n)';
      uncertain = false;
    } else if (/o\(n\)|linear scan|single pass|single linear/.test(blob)) {
      timeComplexity = 'O(n)';
      uncertain = false;
    } else if (/constant time|o\(1\) time/.test(blob)) {
      timeComplexity = 'O(1)';
      uncertain = false;
    }

    if (/o\(n\)\s*space|hash\s*map|dictionary|set\b|dp\s*array/.test(blob)) {
      spaceComplexity = 'O(n)';
    } else if (/o\(1\)\s*(extra )?space|constant\s*space|in[- ]place/.test(blob)) {
      spaceComplexity = 'O(1)';
    }

    if (input.type === 'sql' || input.type === 'system_design' || input.type === 'theoretical') {
      uncertain = true;
    }

    return {
      timeComplexity,
      spaceComplexity,
      reasoning:
        input.algorithm?.trim() ||
        'Complexity estimated from the proposed approach; not formally verified.',
      uncertain,
    };
  }

  fromNormalized(_normalized: NormalizedProblem): ComplexityAnalysis {
    return {
      timeComplexity: 'O(n)',
      spaceComplexity: 'O(1)',
      reasoning: 'Default estimate pending solution generation.',
      uncertain: true,
    };
  }
}
