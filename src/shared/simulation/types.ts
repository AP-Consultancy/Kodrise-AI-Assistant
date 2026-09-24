import type { QuestionType } from '../questions/types';

export type SimulationDifficulty = 'easy' | 'medium' | 'hard';

export type SimulationAnswerStyle = 'short' | 'normal' | 'detailed';

export interface JavaInterviewQuestion {
  id: string;
  interviewerQuestion: string;
  category: string;
  difficulty: SimulationDifficulty;
  expectedClassification: QuestionType;
  mockAnswer: string;
  keyPoints: string[];
  followUpQuestion: string | null;
  followUpAnswer: string | null;
  followUpKeyPoints: string[];
  expectedAnswerStyle: SimulationAnswerStyle;
}

export interface SimulationConfig {
  /** When true, advance automatically after an answer completes. Default false. */
  autoAdvance: boolean;
  questionDelayMs: number;
  answerDisplayDelayMs: number;
  chunkDelayMs: number;
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  autoAdvance: false,
  /** Combined with answerDisplayDelayMs for auto-advance wait (default total 2500ms). */
  questionDelayMs: 2500,
  answerDisplayDelayMs: 0,
  chunkDelayMs: 30,
};

export interface SimulationProgress {
  currentIndex: number;
  totalQuestions: number;
  askedCount: number;
  percentComplete: number;
}

export interface SimulationPublicStatus {
  interviewStarted: boolean;
  interviewCompleted: boolean;
  paused: boolean;
  waitingForAnswer: boolean;
  answerReady: boolean;
  currentQuestionIndex: number;
  totalQuestions: number;
  askedQuestions: string[];
  /** Dataset id such as Q01 — shown in product UI / safe logs. */
  simulationQuestionId: string | null;
  /** @deprecated use simulationQuestionId */
  currentQuestionId: string | null;
  /** Internal runtime UUID — not shown in candidate UI. */
  runtimeQuestionId: string | null;
  currentQuestion: string | null;
  previousQuestion: string | null;
  category: string | null;
  difficulty: SimulationDifficulty | null;
  keyPoints: string[];
  isFollowUp: boolean;
  progress: SimulationProgress;
  config: SimulationConfig;
  candidateProfile: string;
}
