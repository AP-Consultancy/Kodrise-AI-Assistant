import type { DetectedQuestion } from '../../shared/questions/types';
import { QUESTION_BUFFER } from '../../shared/questions/types';

export type DuplicateRelation = 'exact' | 'extension' | 'prefix' | null;

export class QuestionDuplicateDetector {
  isDuplicate(
    normalizedText: string,
    recent: DetectedQuestion[],
    sourceSegmentIds: string[],
    now = Date.now(),
  ): DetectedQuestion | null {
    return this.findRelated(normalizedText, recent, sourceSegmentIds, now).question;
  }

  /**
   * Returns a recent question that is the same logical utterance, including
   * progressive STT extensions ("can you tell me what" → "... what java is?").
   */
  findRelated(
    normalizedText: string,
    recent: DetectedQuestion[],
    sourceSegmentIds: string[],
    now = Date.now(),
  ): { question: DetectedQuestion | null; relation: DuplicateRelation } {
    for (const question of recent) {
      const withinWindow = Math.abs(now - question.timestamp) <= QUESTION_BUFFER.DUPLICATE_WINDOW_MS;
      if (!withinWindow) {
        continue;
      }

      const sharedSegments = sourceSegmentIds.some((id) => question.sourceSegmentIds.includes(id));
      if (sharedSegments) {
        return { question, relation: 'exact' };
      }

      const similarity = this.similarity(normalizedText, question.normalizedText);
      if (similarity >= QUESTION_BUFFER.DUPLICATE_SIMILARITY) {
        return { question, relation: 'exact' };
      }

      const relation = this.prefixRelation(normalizedText, question.normalizedText);
      if (relation) {
        return { question, relation };
      }
    }
    return { question: null, relation: null };
  }

  /** Token Jaccard similarity on normalized lowercase words. */
  similarity(a: string, b: string): number {
    const left = new Set(this.tokens(a));
    const right = new Set(this.tokens(b));
    if (left.size === 0 && right.size === 0) {
      return 1;
    }
    let intersection = 0;
    for (const token of left) {
      if (right.has(token)) {
        intersection += 1;
      }
    }
    const union = left.size + right.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Detects progressive STT growth / shrinkage of the same question.
   * Requires the shorter form to be a word-prefix of the longer form.
   */
  prefixRelation(a: string, b: string): DuplicateRelation {
    const left = this.tokens(a);
    const right = this.tokens(b);
    if (left.length === 0 || right.length === 0) {
      return null;
    }
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length <= right.length ? right : left;
    if (shorter.length < 3) {
      return null;
    }
    // Require substantial overlap so unrelated questions sharing a polite stem
    // ("can you tell me") are not collapsed.
    if (shorter.length / longer.length < 0.55 && shorter.length < 5) {
      return null;
    }
    for (let i = 0; i < shorter.length; i += 1) {
      if (shorter[i] !== longer[i]) {
        return null;
      }
    }
    if (left.length === right.length) {
      return 'exact';
    }
    return left.length > right.length ? 'extension' : 'prefix';
  }

  private tokens(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1);
  }
}
