import { BrowserWindow } from 'electron';
import { JavaInterviewSimulationService } from '../../core/simulation/JavaInterviewSimulationService';
import type { SimulationConfig, SimulationPublicStatus } from '../../shared/simulation/types';
import { IpcEvents } from '../../shared/ipc/channels';
import type { InterviewHost } from '../interview/InterviewHost';
import type { AudioHost } from '../services/audio/AudioHost';
import type { ConfigurationService } from '../../core/configuration/ConfigurationService';
import type { AIEvent } from '../../shared/ai/types';
import { logger } from '../services/logging';

export interface SimulationHostDeps {
  interview: InterviewHost;
  audio: AudioHost;
  config: ConfigurationService;
}

/**
 * Drives the Java interview simulation through Context → MockAI.
 * Isolated from microphone / Deepgram question detection.
 */
export class SimulationHost {
  private readonly service = new JavaInterviewSimulationService();
  private readonly interview: InterviewHost;
  private readonly audio: AudioHost;
  private readonly config: ConfigurationService;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribers: Array<() => void> = [];
  private injecting = false;
  private nextInFlight = false;

  constructor(deps: SimulationHostDeps) {
    this.interview = deps.interview;
    this.audio = deps.audio;
    this.config = deps.config;
    this.unsubscribers.push(
      this.audio.subscribeAi((event: AIEvent) => {
        if (event.type === 'ai.response.completed') {
          this.onAnswerCompleted(event.questionId);
        } else if (event.type === 'ai.response.error' || event.type === 'ai.response.cancelled') {
          const status = this.service.getProgress();
          if (status.interviewStarted && !status.interviewCompleted && status.waitingForAnswer) {
            this.service.submitAnswer();
            this.broadcast();
          }
        }
      }),
    );
  }

  dispose(): void {
    this.clearTimer();
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }

  getStatus(): SimulationPublicStatus {
    return this.service.getProgress();
  }

  async start(): Promise<SimulationPublicStatus> {
    this.clearTimer();
    this.nextInFlight = false;
    try {
      this.config.update({
        ai: {
          provider: 'mock',
          autoGenerate: true,
          minClassificationConfidence: 0.3,
        },
      });
    } catch {
      // ignore
    }

    const interviewStatus = this.interview.getStatus();
    if (interviewStatus.phase !== 'live') {
      await this.interview.startInterview({ mode: 'simulation' });
    } else if (interviewStatus.executionMode !== 'simulation') {
      await this.interview.enterSimulationMode();
    } else if (interviewStatus.paused) {
      // Stay in simulation; do not resume microphone listening.
      await this.interview.enterSimulationMode();
    }

    this.service.startSimulation();
    this.broadcast();
    await this.injectCurrentQuestion();
    return this.getStatus();
  }

  pause(): SimulationPublicStatus {
    this.clearTimer();
    const status = this.service.pause();
    this.broadcast();
    return status;
  }

  resume(): SimulationPublicStatus {
    const status = this.service.resume();
    this.broadcast();
    if (
      status.config.autoAdvance &&
      !status.waitingForAnswer &&
      status.answerReady &&
      !status.interviewCompleted &&
      status.interviewStarted
    ) {
      this.scheduleNext();
    }
    return this.getStatus();
  }

  async next(): Promise<SimulationPublicStatus> {
    if (this.nextInFlight || this.injecting) {
      return this.getStatus();
    }
    this.nextInFlight = true;
    this.clearTimer();
    try {
      const before = this.service.getProgress();
      if (!before.interviewStarted || before.interviewCompleted) {
        return before;
      }
      this.service.submitAnswer();
      this.service.nextQuestion();
      const after = this.service.getProgress();
      this.broadcast();
      if (after.interviewCompleted) {
        return after;
      }
      await this.injectCurrentQuestion();
      return this.getStatus();
    } finally {
      this.nextInFlight = false;
    }
  }

  async restart(): Promise<SimulationPublicStatus> {
    this.clearTimer();
    this.nextInFlight = false;
    this.service.resetSimulation();
    this.broadcast();
    const interviewStatus = this.interview.getStatus();
    if (interviewStatus.phase !== 'live' || interviewStatus.executionMode !== 'simulation') {
      await this.interview.startInterview({ mode: 'simulation' });
    } else {
      await this.interview.enterSimulationMode();
    }
    await this.injectCurrentQuestion();
    return this.getStatus();
  }

  async end(): Promise<SimulationPublicStatus> {
    this.clearTimer();
    this.nextInFlight = false;
    const status = this.service.endSimulation();
    try {
      await this.interview.exitSimulationMode();
    } catch {
      // ignore
    }
    this.broadcast();
    return status;
  }

  updateConfig(patch: Partial<SimulationConfig>): SimulationPublicStatus {
    this.service.updateConfig(patch);
    this.broadcast();
    return this.getStatus();
  }

  private onAnswerCompleted(questionId: string): void {
    const status = this.service.getProgress();
    if (!status.interviewStarted || status.interviewCompleted || !status.waitingForAnswer) {
      return;
    }
    // Ignore AI completions that are not for the active simulation question.
    if (status.runtimeQuestionId && questionId && status.runtimeQuestionId !== questionId) {
      return;
    }
    this.service.submitAnswer();
    this.broadcast();
    logger.info('simulation.answer.completed', {
      simulationQuestionId: status.simulationQuestionId,
      runtimeQuestionId: status.runtimeQuestionId,
    });
    if (status.config.autoAdvance && !this.service.getProgress().paused) {
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    this.clearTimer();
    const status = this.service.getProgress();
    if (
      !status.interviewStarted ||
      status.interviewCompleted ||
      status.paused ||
      !status.config.autoAdvance
    ) {
      return;
    }
    const delay =
      this.service.getConfig().answerDisplayDelayMs + this.service.getConfig().questionDelayMs;
    this.timer = setTimeout(() => {
      void this.next();
    }, delay);
  }

  private async injectCurrentQuestion(): Promise<void> {
    if (this.injecting) {
      return;
    }
    const text = this.service.getActiveQuestionText();
    const simulationQuestionId = this.service.getActiveSimulationQuestionId();
    if (!text || !simulationQuestionId) {
      return;
    }
    this.injecting = true;
    try {
      // Ensure mic cannot feed questions while we inject.
      this.audio.setMicrophoneQuestionIngest(false);

      const isFollowUp = this.service.isFollowUpStep();
      const parentQuestionId = isFollowUp
        ? this.service.getPreviousRuntimeQuestionId()
        : null;

      const result = await this.interview.submitSimulatedQuestion(text, {
        simulationQuestionId,
        expectedType: this.service.getActiveExpectedType() ?? undefined,
        isFollowUp,
        parentQuestionId,
      });

      this.service.markQuestionAsked(result.runtimeQuestionId);
      this.broadcast();

      logger.info('simulation.question.started', {
        simulationQuestionId,
        runtimeQuestionId: result.runtimeQuestionId,
        isFollowUp,
      });

      logger.info('simulation.question_injected', {
        simulationQuestionId,
        runtimeQuestionId: result.runtimeQuestionId,
        isFollowUp,
      });
    } catch (error) {
      logger.warn('simulation.question_inject_failed', {
        message: error instanceof Error ? error.message : 'unknown',
        simulationQuestionId,
      });
    } finally {
      this.injecting = false;
      this.broadcast();
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private broadcast(): void {
    const status = this.getStatus();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcEvents.SIMULATION_STATUS_CHANGED, status);
      }
    }
  }
}
