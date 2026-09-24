import type { DetectedQuestion } from '../../shared/questions/types';
import type {
  DocumentContextExcerpt,
  InterviewDocumentContext,
} from '../../shared/context/types';
import type { SessionDocumentKind } from '../../shared/interview/types';

export interface DocumentCandidate {
  id: string;
  fileName: string;
  kind: SessionDocumentKind;
  text: string;
  truncated: boolean;
}

const RESUME_HINTS = [
  'experience',
  'skill',
  'project',
  'worked',
  'employment',
  'education',
  'achievement',
  'background',
  'career',
  'resume',
  'cv',
  'yourself',
  'strength',
  'weakness',
];

const JD_HINTS = [
  'role',
  'require',
  'qualification',
  'responsib',
  'expect',
  'position',
  'candidate',
  'job',
  'must have',
  'technology',
  'technologies',
  'stack',
  'hiring',
];

const SUPPORTING_HINTS = [
  'architecture',
  'implement',
  'kafka',
  'service',
  'system',
  'design',
  'technical',
  'project',
  'why was',
  'how did',
  'payment',
  'event',
  'async',
];

/**
 * Deterministic, provider-independent document relevance for Phase 2J.
 * No LLM / embeddings — type priors + keyword overlap + local windows.
 */
export class DocumentRelevanceSelector {
  select(input: {
    question: DetectedQuestion;
    documents: DocumentCandidate[];
    maxExcerpts?: number;
    maxCharsPerExcerpt?: number;
  }): InterviewDocumentContext {
    const maxExcerpts = input.maxExcerpts ?? 4;
    const maxChars = input.maxCharsPerExcerpt ?? 1200;
    const questionText = `${input.question.text} ${input.question.normalizedText}`.toLowerCase();
    const tokens = tokenize(questionText);

    const scored = input.documents
      .filter((doc) => doc.text.trim().length > 0)
      .map((doc) => {
        const typePrior = typePriorScore(doc.kind, questionText, input.question.type);
        const overlap = keywordOverlapScore(tokens, doc.text);
        const score = typePrior + overlap;
        const windowed = extractRelevantWindow(doc.text, tokens, maxChars);
        return {
          excerpt: {
            id: doc.id,
            fileName: doc.fileName,
            kind: doc.kind,
            text: windowed.text,
            relevanceScore: Number(score.toFixed(3)),
            relevanceReason: describeReason(doc.kind, typePrior, overlap),
            truncated: doc.truncated || windowed.truncated,
          } satisfies DocumentContextExcerpt,
          score,
        };
      })
      .filter((item) => item.score >= 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxExcerpts);

    // Ensure at least the strongest type-prior document when nothing clears the threshold
    // but documents exist and the question is clearly personal/role related.
    if (scored.length === 0 && input.documents.length > 0) {
      const fallback = pickFallback(input.documents, questionText, input.question.type);
      if (fallback) {
        const windowed = extractRelevantWindow(fallback.text, tokens, maxChars);
        scored.push({
          excerpt: {
            id: fallback.id,
            fileName: fallback.fileName,
            kind: fallback.kind,
            text: windowed.text,
            relevanceScore: 0.2,
            relevanceReason: 'fallback_type_prior',
            truncated: fallback.truncated || windowed.truncated,
          },
          score: 0.2,
        });
      }
    }

    return toInterviewDocumentContext(scored.map((item) => item.excerpt));
  }
}

export function toInterviewDocumentContext(
  excerpts: DocumentContextExcerpt[],
): InterviewDocumentContext {
  const resume = excerpts.find((item) => item.kind === 'resume') ?? null;
  const jd = excerpts.find((item) => item.kind === 'job_description') ?? null;
  const additional = excerpts.filter((item) => item.kind === 'additional');
  return {
    excerpts,
    resumeExcerpt: resume?.text ?? null,
    jobDescriptionExcerpt: jd?.text ?? null,
    additionalExcerpts: additional.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      text: item.text,
      truncated: item.truncated,
      relevanceScore: item.relevanceScore,
      relevanceReason: item.relevanceReason,
    })),
  };
}

function typePriorScore(
  kind: SessionDocumentKind,
  questionText: string,
  questionType: DetectedQuestion['type'],
): number {
  const resumeHit = RESUME_HINTS.some((hint) => questionText.includes(hint));
  const jdHit = JD_HINTS.some((hint) => questionText.includes(hint));
  const supportHit = SUPPORTING_HINTS.some((hint) => questionText.includes(hint));

  if (kind === 'resume') {
    if (resumeHit || questionType === 'behavioral') return 0.55;
    if (questionType === 'technical' || questionType === 'coding') return 0.25;
    return 0.12;
  }
  if (kind === 'job_description') {
    if (jdHit) return 0.6;
    if (questionType === 'technical') return 0.2;
    return 0.1;
  }
  // supporting / additional
  if (
    supportHit ||
    questionType === 'technical' ||
    questionType === 'coding' ||
    questionType === 'system_design' ||
    questionType === 'architecture' ||
    questionType === 'project'
  ) {
    return 0.45;
  }
  return 0.08;
}

function keywordOverlapScore(tokens: string[], documentText: string): number {
  if (tokens.length === 0) return 0;
  const lower = documentText.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (lower.includes(token)) hits += 1;
  }
  return Math.min(0.7, hits * 0.12);
}

function extractRelevantWindow(
  text: string,
  tokens: string[],
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const lower = text.toLowerCase();
  let bestIndex = 0;
  for (const token of tokens) {
    if (token.length < 3) continue;
    const index = lower.indexOf(token);
    if (index >= 0) {
      bestIndex = Math.max(0, index - Math.floor(maxChars * 0.25));
      break;
    }
  }

  const slice = text.slice(bestIndex, bestIndex + maxChars);
  const prefix = bestIndex > 0 ? '…' : '';
  const suffix = bestIndex + maxChars < text.length ? '\n…[document truncated]' : '';
  return { text: `${prefix}${slice}${suffix}`, truncated: true };
}

function pickFallback(
  documents: DocumentCandidate[],
  questionText: string,
  questionType: DetectedQuestion['type'],
): DocumentCandidate | null {
  const ranked = [...documents].sort(
    (a, b) =>
      typePriorScore(b.kind, questionText, questionType) -
      typePriorScore(a.kind, questionText, questionType),
  );
  return ranked[0] ?? null;
}

function describeReason(kind: SessionDocumentKind, typePrior: number, overlap: number): string {
  if (overlap >= 0.24 && typePrior >= 0.4) return `${kind}_type_and_keyword_match`;
  if (overlap >= 0.24) return `${kind}_keyword_overlap`;
  if (typePrior >= 0.4) return `${kind}_type_prior`;
  return `${kind}_weak_match`;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}
