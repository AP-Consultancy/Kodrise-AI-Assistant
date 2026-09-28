/**
 * Phase 2Q — user-triggered question capture (explicit hotkey only).
 * No continuous polling / background capture.
 */

import type {
  ProgrammingLanguage,
  ProblemType,
  SqlDialect,
} from '../problem-intelligence/types';

export type QuestionCaptureMode = 'region' | 'active_window' | 'full_screen';

export type QuestionCapturePhase =
  | 'idle'
  | 'selecting'
  | 'preview'
  | 'analyzing'
  | 'error'
  | 'cancelled';

export interface QuestionCapturePublicConfig {
  /** Electron accelerator, e.g. CommandOrControl+Shift+Q */
  hotkey: string;
  captureMode: QuestionCaptureMode;
}

export const DEFAULT_QUESTION_CAPTURE_CONFIG: QuestionCapturePublicConfig = {
  hotkey: 'CommandOrControl+Shift+Q',
  captureMode: 'region',
};

export interface CapturedQuestion {
  id: string;
  frameId: string | null;
  extractedText: string;
  cleanedText: string;
  detectedQuestionType: ProblemType;
  detectedLanguage: ProgrammingLanguage;
  detectedSqlDialect: SqlDialect;
  detectedCode: string | null;
  detectedConstraints: string[];
  detectedExamples: string[];
  confidence: number;
  warnings: string[];
  isFollowUp: boolean;
  isIncomplete: boolean;
  multipleQuestions: string[];
  createdAt: number;
}

export interface QuestionCapturePreview {
  captureId: string;
  /** Transient preview data URL for confirmation UI only — not persisted. */
  previewDataUrl: string | null;
  width: number;
  height: number;
  mode: QuestionCaptureMode;
}

export interface QuestionCaptureStatus {
  phase: QuestionCapturePhase;
  hotkey: string;
  hotkeyRegistered: boolean;
  hotkeyError: string | null;
  captureMode: QuestionCaptureMode;
  activeCaptureId: string | null;
  lastError: string | null;
  lastCapturedQuestionId: string | null;
  enabled: boolean;
}

export type QuestionCaptureEventType =
  | 'capture.started'
  | 'capture.preview'
  | 'capture.cancelled'
  | 'capture.analyzing'
  | 'capture.completed'
  | 'capture.failed'
  | 'capture.hotkey_changed'
  | 'capture.multiple_questions'
  | 'capture.language_required';

export interface QuestionCaptureEvent {
  type: QuestionCaptureEventType;
  timestamp: number;
  captureId?: string;
  message?: string;
  preview?: QuestionCapturePreview;
  captured?: CapturedQuestion;
  questions?: string[];
  status?: QuestionCaptureStatus;
}

export interface QuestionCaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Display bounds origin for multi-monitor mapping */
  displayId?: number;
}
