import type {
  JavaInterviewQuestion,
  SimulationConfig,
  SimulationProgress,
  SimulationPublicStatus,
} from '../../shared/simulation/types';
import { DEFAULT_SIMULATION_CONFIG } from '../../shared/simulation/types';
import { getJavaInterviewDataset } from './javaInterviewDataset';

export type SimulationStepKind = 'main' | 'follow_up';

/**
 * Deterministic Java interview simulation state machine (test mode).
 * Does not call network providers — hosts inject questions into the real pipeline.
 */
export class JavaInterviewSimulationService {
  private readonly dataset: readonly JavaInterviewQuestion[];
  private config: SimulationConfig;
  private interviewStarted = false;
  private interviewCompleted = false;
  private paused = false;
  private waitingForAnswer = false;
  private answerReady = false;
  private currentQuestionIndex = 0;
  private stepKind: SimulationStepKind = 'main';
  private askedQuestions: string[] = [];
  private previousQuestion: string | null = null;
  private runtimeQuestionId: string | null = null;
  private previousRuntimeQuestionId: string | null = null;
  private advancingLocked = false;

  constructor(options?: {
    dataset?: readonly JavaInterviewQuestion[];
    config?: Partial<SimulationConfig>;
  }) {
    this.dataset = options?.dataset ?? getJavaInterviewDataset();
    this.config = { ...DEFAULT_SIMULATION_CONFIG, ...options?.config };
  }

  startSimulation(): SimulationPublicStatus {
    this.interviewStarted = true;
    this.interviewCompleted = false;
    this.paused = false;
    this.waitingForAnswer = false;
    this.answerReady = false;
    this.currentQuestionIndex = 0;
    this.stepKind = 'main';
    this.askedQuestions = [];
    this.previousQuestion = null;
    this.runtimeQuestionId = null;
    this.previousRuntimeQuestionId = null;
    this.advancingLocked = false;
    return this.getProgress();
  }

  getCurrentQuestion(): JavaInterviewQuestion | null {
    if (!this.interviewStarted || this.interviewCompleted) {
      return null;
    }
    return this.dataset[this.currentQuestionIndex] ?? null;
  }

  getActiveQuestionText(): string | null {
    const current = this.getCurrentQuestion();
    if (!current) {
      return null;
    }
    if (this.stepKind === 'follow_up') {
      return current.followUpQuestion;
    }
    return current.interviewerQuestion;
  }

  getActiveSimulationQuestionId(): string | null {
    const current = this.getCurrentQuestion();
    if (!current) {
      return null;
    }
    if (this.stepKind === 'follow_up') {
      return `${current.id}-followup`;
    }
    return current.id;
  }

  getActiveKeyPoints(): string[] {
    const current = this.getCurrentQuestion();
    if (!current) {
      return [];
    }
    if (this.stepKind === 'follow_up') {
      return current.followUpKeyPoints;
    }
    return current.keyPoints;
  }

  getActiveExpectedType() {
    return this.getCurrentQuestion()?.expectedClassification ?? null;
  }

  getPreviousRuntimeQuestionId(): string | null {
    return this.previousRuntimeQuestionId;
  }

  isFollowUpStep(): boolean {
    return this.stepKind === 'follow_up';
  }

  /** Mark the active question as asked (after injection into the pipeline). */
  markQuestionAsked(runtimeQuestionId: string | null): SimulationPublicStatus {
    const text = this.getActiveQuestionText();
    if (text && !this.askedQuestions.includes(text)) {
      this.askedQuestions.push(text);
    }
    this.previousRuntimeQuestionId = this.runtimeQuestionId;
    this.runtimeQuestionId = runtimeQuestionId;
    this.waitingForAnswer = true;
    this.answerReady = false;
    this.advancingLocked = false;
    return this.getProgress();
  }

  submitAnswer(): SimulationPublicStatus {
    this.waitingForAnswer = false;
    this.answerReady = true;
    return this.getProgress();
  }

  /**
   * Advance to the next interviewer prompt.
   * Prefers an unused follow-up on the current item, then the next main question.
   * Guarded against double-advance until markQuestionAsked unlocks.
   */
  nextQuestion(): SimulationPublicStatus {
    if (!this.interviewStarted || this.interviewCompleted) {
      return this.getProgress();
    }
    if (this.advancingLocked) {
      return this.getProgress();
    }
    this.advancingLocked = true;

    const current = this.getCurrentQuestion();
    this.previousQuestion = this.getActiveQuestionText();
    this.waitingForAnswer = false;
    this.answerReady = false;

    if (this.stepKind === 'main' && current?.followUpQuestion && current.followUpAnswer) {
      this.stepKind = 'follow_up';
      return this.getProgress();
    }

    if (this.currentQuestionIndex >= this.dataset.length - 1) {
      this.interviewCompleted = true;
      this.stepKind = 'main';
      this.advancingLocked = false;
      return this.getProgress();
    }

    this.currentQuestionIndex += 1;
    this.stepKind = 'main';
    return this.getProgress();
  }

  canAdvance(): boolean {
    if (!this.interviewStarted || this.interviewCompleted) {
      return false;
    }
    const current = this.getCurrentQuestion();
    if (this.stepKind === 'main' && current?.followUpQuestion && current.followUpAnswer) {
      return true;
    }
    return this.currentQuestionIndex < this.dataset.length - 1;
  }

  pause(): SimulationPublicStatus {
    this.paused = true;
    return this.getProgress();
  }

  resume(): SimulationPublicStatus {
    this.paused = false;
    return this.getProgress();
  }

  resetSimulation(): SimulationPublicStatus {
    return this.startSimulation();
  }

  endSimulation(): SimulationPublicStatus {
    this.interviewStarted = false;
    this.interviewCompleted = true;
    this.paused = false;
    this.waitingForAnswer = false;
    this.answerReady = false;
    this.advancingLocked = false;
    return this.getProgress();
  }

  updateConfig(patch: Partial<SimulationConfig>): SimulationConfig {
    this.config = { ...this.config, ...patch };
    return { ...this.config };
  }

  getConfig(): SimulationConfig {
    return { ...this.config };
  }

  getProgress(): SimulationPublicStatus {
    const current = this.getCurrentQuestion();
    const total = this.dataset.length;
    const simId = this.getActiveSimulationQuestionId();
    const progress: SimulationProgress = {
      currentIndex: this.interviewStarted ? this.currentQuestionIndex + 1 : 0,
      totalQuestions: total,
      askedCount: this.askedQuestions.length,
      percentComplete: total === 0 ? 0 : Math.round((this.askedQuestions.length / total) * 100),
    };

    return {
      interviewStarted: this.interviewStarted,
      interviewCompleted: this.interviewCompleted,
      paused: this.paused,
      waitingForAnswer: this.waitingForAnswer,
      answerReady: this.answerReady,
      currentQuestionIndex: this.currentQuestionIndex,
      totalQuestions: total,
      askedQuestions: [...this.askedQuestions],
      simulationQuestionId: simId,
      currentQuestionId: simId,
      runtimeQuestionId: this.runtimeQuestionId,
      currentQuestion: this.getActiveQuestionText(),
      previousQuestion: this.previousQuestion,
      category: current?.category ?? null,
      difficulty: current?.difficulty ?? null,
      keyPoints: this.getActiveKeyPoints(),
      isFollowUp: this.stepKind === 'follow_up',
      progress,
      config: this.getConfig(),
      candidateProfile: '3+ Years Java Backend Developer',
    };
  }
}
