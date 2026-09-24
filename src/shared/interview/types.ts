export type SessionDocumentKind = 'resume' | 'job_description' | 'additional';

export type SessionDocumentFormat = 'pdf' | 'docx' | 'txt' | 'md' | 'unsupported';

export type { DocumentType, DocumentProcessingStatus } from './documentTypes';
export { toDocumentType, documentTypeLabel } from './documentTypes';
import type { DocumentProcessingStatus } from './documentTypes';

export interface SessionDocumentMeta {
  id: string;
  kind: SessionDocumentKind;
  fileName: string;
  format: SessionDocumentFormat;
  size: number;
  /** @deprecated use size */
  byteSize: number;
  source: 'file_picker';
  status: DocumentProcessingStatus;
  extractedTextLength: number;
  createdAt: number;
  updatedAt: number;
  /** @deprecated use createdAt */
  uploadedAt: number;
  characterCount: number;
  truncated: boolean;
  errorMessage: string | null;
}

/** Bounded extracted text held in main memory for the session. */
export interface SessionDocument extends SessionDocumentMeta {
  text: string;
}

export interface InterviewSessionContext {
  resume: SessionDocument | null;
  jobDescription: SessionDocument | null;
  additionalDocuments: SessionDocument[];
  /** Bounded excerpts for Context Engine (no raw files). */
  resumeExcerpt: string | null;
  jobDescriptionExcerpt: string | null;
  additionalExcerpts: Array<{ id: string; fileName: string; text: string }>;
  documentCount: number;
  totalCharacters: number;
}

export interface InterviewSessionContextPublic {
  resume: SessionDocumentMeta | null;
  jobDescription: SessionDocumentMeta | null;
  additionalDocuments: SessionDocumentMeta[];
  documentCount: number;
  totalCharacters: number;
}

export type InterviewProductPhase = 'prepare' | 'live' | 'summary';

/** Real mic/STT interview vs offline Java simulation (MockAI). */
export type InterviewExecutionMode = 'real' | 'simulation';

export type InterviewUiState =
  | 'idle'
  | 'listening'
  | 'question_detected'
  | 'building_context'
  | 'analyzing_visual'
  | 'generating'
  | 'ready'
  | 'error'
  | 'paused';

export const INTERVIEW_UI_STATE_LABELS: Record<InterviewUiState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  question_detected: 'Question detected',
  building_context: 'Preparing answer',
  analyzing_visual: 'Checking visual context',
  generating: 'Generating answer',
  ready: 'Ready',
  error: 'Something went wrong',
  paused: 'Paused',
};

export interface InterviewSummary {
  durationMs: number;
  questionCount: number;
  answersGenerated: number;
  visualAnalyses: number;
  errorCount: number;
  endedAt: number;
}

export interface InterviewStatus {
  phase: InterviewProductPhase;
  executionMode: InterviewExecutionMode;
  uiState: InterviewUiState;
  uiStateLabel: string;
  sessionId: string | null;
  startedAt: number | null;
  paused: boolean;
  listening: boolean;
  currentQuestionId: string | null;
  currentQuestionText: string | null;
  answerText: string;
  answerStatus: string | null;
  errorMessage: string | null;
  documents: InterviewSessionContextPublic;
  summary: InterviewSummary | null;
}

export interface InterviewDocumentLimits {
  maxResumeCharacters: number;
  maxJobDescriptionCharacters: number;
  maxAdditionalCharactersPerDoc: number;
  maxAdditionalDocuments: number;
  maxFileBytes: number;
}

export const DEFAULT_INTERVIEW_DOCUMENT_LIMITS: InterviewDocumentLimits = {
  maxResumeCharacters: 6000,
  maxJobDescriptionCharacters: 4000,
  maxAdditionalCharactersPerDoc: 2500,
  maxAdditionalDocuments: 5,
  maxFileBytes: 8_000_000,
};

export const SUPPORTED_DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown'] as const;
