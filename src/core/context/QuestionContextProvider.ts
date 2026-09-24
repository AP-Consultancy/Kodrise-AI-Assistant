import type { DetectedQuestion } from '../../shared/questions/types';
import type { ContextBudget } from '../../shared/context/types';
import { DEFAULT_CONTEXT_BUDGET } from '../../shared/context/types';

export interface QuestionWindowResult {
  recentQuestions: DetectedQuestion[];
  relatedQuestions: DetectedQuestion[];
  omittedCount: number;
}

/**
 * Builds bounded question history + relationship set from Phase 2C metadata.
 */
export class QuestionContextProvider {
  select(
    current: DetectedQuestion,
    history: DetectedQuestion[],
    budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
  ): QuestionWindowResult {
    const related: DetectedQuestion[] = [];
    const relatedIds = new Set<string>();

    if (current.parentQuestionId) {
      const parent = history.find((question) => question.id === current.parentQuestionId);
      if (parent) {
        related.push(structuredClone(parent));
        relatedIds.add(parent.id);
      }
    }
    if (current.relatedQuestionId && current.relatedQuestionId !== current.parentQuestionId) {
      const relatedQuestion = history.find((question) => question.id === current.relatedQuestionId);
      if (relatedQuestion && !relatedIds.has(relatedQuestion.id)) {
        related.push(structuredClone(relatedQuestion));
        relatedIds.add(relatedQuestion.id);
      }
    }

    // Follow-ups that point at current, or share the same parent.
    for (const question of history) {
      if (related.length >= budget.maxRelatedQuestions) {
        break;
      }
      if (question.id === current.id || relatedIds.has(question.id)) {
        continue;
      }
      if (
        question.parentQuestionId === current.id ||
        (current.parentQuestionId && question.parentQuestionId === current.parentQuestionId)
      ) {
        related.push(structuredClone(question));
        relatedIds.add(question.id);
      }
    }

    const recent: DetectedQuestion[] = [];
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const question = history[index]!;
      if (question.id === current.id) {
        continue;
      }
      if (relatedIds.has(question.id)) {
        continue;
      }
      if (recent.length >= budget.maxQuestionCount) {
        break;
      }
      recent.unshift(structuredClone(question));
    }

    const keptIds = new Set([
      current.id,
      ...related.map((question) => question.id),
      ...recent.map((question) => question.id),
    ]);
    const omittedCount = history.filter((question) => !keptIds.has(question.id)).length;

    return {
      recentQuestions: recent,
      relatedQuestions: related.slice(0, budget.maxRelatedQuestions),
      omittedCount,
    };
  }
}
