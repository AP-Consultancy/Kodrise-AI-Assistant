import type { DetectedQuestion } from '../questions/types';
import type { TranscriptSegment } from '../transcription/types';
import type { VisualContextSnapshot } from '../visual-context/types';

export type ContextSourceKind =
  | 'transcript'
  | 'question_history'
  | 'session'
  | 'user_context'
  | 'project_context'
  | 'visual_context'
  | 'interview_documents';

/** Bounded interview document excerpts for prompts — not raw files. */
export interface DocumentContextExcerpt {
  id: string;
  fileName: string;
  kind: 'resume' | 'job_description' | 'additional';
  text: string;
  relevanceScore: number;
  relevanceReason: string;
  truncated: boolean;
}

export interface InterviewDocumentContext {
  /** Question-relevant excerpts (preferred for prompts). */
  excerpts: DocumentContextExcerpt[];
  /** Flat mirrors for compatibility with existing consumers. */
  resumeExcerpt: string | null;
  jobDescriptionExcerpt: string | null;
  additionalExcerpts: Array<{
    id?: string;
    fileName: string;
    text: string;
    truncated?: boolean;
    relevanceScore?: number;
    relevanceReason?: string;
  }>;
}

/** Explicitly supplied profile notes — never scraped. */
export interface UserContext {
  name?: string;
  role?: string;
  experience?: string;
  skills?: string[];
  preferences?: Record<string, string>;
}

/** Explicitly supplied project notes — never auto-indexed. */
export interface ProjectContext {
  projectName?: string;
  description?: string;
  technologies?: string[];
  architecture?: string;
  responsibilities?: string[];
}

export interface ContextBudget {
  maxTranscriptSegments: number;
  maxTranscriptCharacters: number;
  maxQuestionCount: number;
  maxRelatedQuestions: number;
  maxContextCharacters: number;
  maxRecentSnapshots: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxTranscriptSegments: 12,
  maxTranscriptCharacters: 2400,
  maxQuestionCount: 6,
  maxRelatedQuestions: 3,
  maxContextCharacters: 6000,
  maxRecentSnapshots: 20,
};

export interface ContextMetadata {
  truncated: boolean;
  omittedTranscriptSegments: number;
  omittedQuestions: number;
  omittedDocumentExcerpts: number;
  documentTruncated: boolean;
  sources: ContextSourceKind[];
  characterCount: number;
  budget: ContextBudget;
  visualFrameCount?: number;
  visualFramesDiscarded?: number;
  visualTruncated?: boolean;
  visualPayloadBytes?: number;
  ocrResultCount?: number;
  visionAnalysisCount?: number;
}

export interface ContextQuality {
  completeness: number;
  transcriptCoverage: number;
  relationshipCoverage: number;
  truncated: boolean;
}

export interface ContextSnapshot {
  id: string;
  sessionId: string | null;
  correlationId: string | null;
  questionId: string;
  currentQuestion: DetectedQuestion;
  recentTranscript: TranscriptSegment[];
  recentQuestions: DetectedQuestion[];
  relatedQuestions: DetectedQuestion[];
  userContext: UserContext | null;
  projectContext: ProjectContext | null;
  visualContext: VisualContextSnapshot | null;
  interviewDocuments: InterviewDocumentContext | null;
  createdAt: number;
  metadata: ContextMetadata;
  quality: ContextQuality;
}

export type ContextEventType =
  | 'context.created'
  | 'context.updated'
  | 'context.truncated'
  | 'context.failed';

export interface ContextEvent {
  type: ContextEventType;
  contextId: string;
  questionId: string;
  sessionId: string | null;
  correlationId: string | null;
  timestamp: number;
  metadata?: Pick<ContextMetadata, 'truncated' | 'characterCount' | 'omittedTranscriptSegments' | 'omittedQuestions'>;
}

export interface ContextEngineStatus {
  enabled: boolean;
  snapshotCount: number;
  currentContextId: string | null;
  lastCreatedAt: number | null;
  userContextConfigured: boolean;
  projectContextConfigured: boolean;
}

export interface ContextPublicConfig {
  budget: ContextBudget;
  userContext: UserContext;
  projectContext: ProjectContext;
}

export const DEFAULT_CONTEXT_PUBLIC_CONFIG: ContextPublicConfig = {
  budget: { ...DEFAULT_CONTEXT_BUDGET },
  userContext: {},
  projectContext: {},
};
