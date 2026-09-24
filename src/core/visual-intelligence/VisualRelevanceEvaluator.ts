import type { DetectedQuestion } from '../../shared/questions/types';
import type { VisualRelevance } from '../../shared/visual-intelligence/types';

export interface VisualRelevanceEvaluator {
  evaluate(question: DetectedQuestion | null): VisualRelevance;
}

/**
 * Deterministic rule-based relevance — not an ML classifier.
 */
export class RuleBasedVisualRelevanceEvaluator implements VisualRelevanceEvaluator {
  evaluate(question: DetectedQuestion | null): VisualRelevance {
    if (!question) {
      return 'UNKNOWN';
    }

    const visualTypes = new Set([
      'coding',
      'system_design',
      'architecture',
      'frontend',
      'backend',
      'database',
      'devops',
      'cloud',
      'technical',
    ]);

    if (visualTypes.has(question.type)) {
      return 'RELEVANT';
    }

    const text = question.normalizedText.toLowerCase();
    const keywords = [
      'screen',
      'screenshot',
      'diagram',
      'code',
      'error',
      'terminal',
      'ui',
      'architecture',
      'schema',
      'flowchart',
    ];
    if (keywords.some((keyword) => text.includes(keyword))) {
      return 'RELEVANT';
    }

    if (question.type === 'behavioral' || question.type === 'general') {
      return 'NOT_RELEVANT';
    }

    return 'UNKNOWN';
  }
}
