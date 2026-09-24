import type { JavaInterviewQuestion } from '../../shared/simulation/types';

/** Normalize interview question text for deterministic matching. */
export function normalizeInterviewQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MatchedInterviewAnswer {
  questionId: string;
  answer: string;
  keyPoints: string[];
  style: JavaInterviewQuestion['expectedAnswerStyle'];
  isFollowUp: boolean;
}

/**
 * Find a dataset answer for a spoken/pasted question.
 * Exact normalized match first, then high token overlap.
 */
export function matchJavaInterviewAnswer(
  spokenQuestion: string,
  dataset: readonly JavaInterviewQuestion[],
): MatchedInterviewAnswer | null {
  const normalized = normalizeInterviewQuestion(spokenQuestion);
  if (!normalized) {
    return null;
  }

  const entries = flattenAnswerEntries(dataset);

  const exact = entries.find((entry) => entry.normalized === normalized);
  if (exact) {
    return exact.match;
  }

  let best: { score: number; match: MatchedInterviewAnswer } | null = null;
  for (const entry of entries) {
    const score = tokenOverlap(normalized, entry.normalized);
    if (score < 0.82) {
      continue;
    }
    if (!best || score > best.score) {
      best = { score, match: entry.match };
    }
  }
  return best?.match ?? null;
}

function flattenAnswerEntries(dataset: readonly JavaInterviewQuestion[]) {
  const entries: Array<{ normalized: string; match: MatchedInterviewAnswer }> = [];
  for (const item of dataset) {
    entries.push({
      normalized: normalizeInterviewQuestion(item.interviewerQuestion),
      match: {
        questionId: item.id,
        answer: item.mockAnswer,
        keyPoints: item.keyPoints,
        style: item.expectedAnswerStyle,
        isFollowUp: false,
      },
    });
    if (item.followUpQuestion && item.followUpAnswer) {
      entries.push({
        normalized: normalizeInterviewQuestion(item.followUpQuestion),
        match: {
          questionId: `${item.id}-followup`,
          answer: item.followUpAnswer,
          keyPoints: item.followUpKeyPoints,
          style: item.expectedAnswerStyle,
          isFollowUp: true,
        },
      });
    }
  }
  return entries;
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(a.split(' ').filter((token) => token.length > 1));
  const right = new Set(b.split(' ').filter((token) => token.length > 1));
  if (left.size === 0 || right.size === 0) {
    return 0;
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
