export type QuestionStatus = 'detected' | 'classified' | 'ignored' | 'failed';

/**
 * Classification precedence (highest first) used only to resolve ambiguity —
 * not a quality ranking.
 */
export const QUESTION_TYPE_PRIORITY = [
  'coding',
  'system_design',
  'architecture',
  'database',
  'cloud',
  'devops',
  'frontend',
  'backend',
  'ai_ml',
  'behavioral',
  'project',
  'technical',
  'follow_up',
  'clarification',
  'multi_part',
  'general',
  'unknown',
] as const;

export type QuestionType = (typeof QUESTION_TYPE_PRIORITY)[number];

export interface DetectedQuestion {
  id: string;
  text: string;
  originalText: string;
  normalizedText: string;
  type: QuestionType;
  status: QuestionStatus;
  timestamp: number;
  sourceSegmentIds: string[];
  detectionConfidence: number;
  classificationConfidence: number;
  isMultiPart: boolean;
  parts: string[];
  parentQuestionId: string | null;
  relatedQuestionId: string | null;
}

export type QuestionEventType =
  | 'question.detected'
  | 'question.classified'
  | 'question.updated'
  | 'question.ignored'
  | 'question.failed';

export interface QuestionEvent {
  type: QuestionEventType;
  questionId: string;
  timestamp: number;
  sessionId: string | null;
  correlationId: string | null;
  question?: DetectedQuestion;
  reason?: string;
}

export interface QuestionStatusSnapshot {
  enabled: boolean;
  questionCount: number;
  currentQuestionId: string | null;
  maxQuestions: number;
  lastProcessedAt: number | null;
}

export interface QuestionPipelineStatus {
  listening: boolean;
  enabled: boolean;
  recentCount: number;
  current: DetectedQuestion | null;
}

/** Detection confidence thresholds (named constants — not magic numbers). */
export const DETECTION_CONFIDENCE = {
  DEFINITE_QUESTION: 0.92,
  STRONG_QUESTION: 0.8,
  LIKELY_QUESTION: 0.65,
  UNCERTAIN: 0.5,
  WEAK: 0.35,
  NOT_QUESTION: 0.15,
  IGNORE_BELOW: 0.45,
} as const;

export const QUESTION_BUFFER = {
  MAX_PENDING_SEGMENTS: 6,
  MAX_GAP_MS: 4500,
  MAX_COMBINED_CHARS: 480,
  MAX_RECENT_QUESTIONS: 50,
  MAX_CONTEXT_SEGMENTS: 20,
  DUPLICATE_WINDOW_MS: 12_000,
  DUPLICATE_SIMILARITY: 0.92,
} as const;
