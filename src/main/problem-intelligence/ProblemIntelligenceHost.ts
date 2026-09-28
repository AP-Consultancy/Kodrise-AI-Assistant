import { BrowserWindow } from 'electron';
import { ProblemIntelligenceOrchestrator } from '../../core/problem-intelligence';
import type {
  CreateProblemInput,
  ExecuteProblemInput,
  ProblemEvent,
  ProblemIntelligenceStatus,
  ProblemResult,
  ReviseProblemInput,
  SelectDialectInput,
  SelectLanguageInput,
} from '../../shared/problem-intelligence/types';
import { IpcEvents } from '../../shared/ipc/channels';
import type { AIProvider } from '../../core/ai/AIProvider';

export interface ProblemIntelligenceHostOptions {
  getAIProvider: () => Promise<AIProvider>;
  sessionId?: () => string | null;
  correlationId?: () => string | null;
}

/**
 * Main-process host for Problem Intelligence (IPC + session lifecycle).
 */
export class ProblemIntelligenceHost {
  private readonly orchestrator: ProblemIntelligenceOrchestrator;
  private readonly unsub: () => void;

  constructor(options: ProblemIntelligenceHostOptions) {
    this.orchestrator = new ProblemIntelligenceOrchestrator({
      getAIProvider: options.getAIProvider,
      sessionId: options.sessionId,
      correlationId: options.correlationId,
    });
    this.unsub = this.orchestrator.subscribe((event) => {
      this.broadcast(IpcEvents.PROBLEM_EVENT, event);
    });
  }

  getStatus(): ProblemIntelligenceStatus {
    return this.orchestrator.getStatus();
  }

  getCurrent(): ProblemResult | null {
    return this.orchestrator.getCurrentResult();
  }

  getResult(problemId: string): ProblemResult | null {
    return this.orchestrator.getResult(problemId);
  }

  list(): ProblemResult[] {
    return this.orchestrator.listResults();
  }

  getEvents(limit?: number): ProblemEvent[] {
    return this.orchestrator.getEvents(limit);
  }

  createAndSolve(input: CreateProblemInput): Promise<ProblemResult> {
    return this.orchestrator.createAndSolve(input);
  }

  selectLanguage(input: SelectLanguageInput): Promise<ProblemResult> {
    return this.orchestrator.selectLanguage(input);
  }

  selectDialect(input: SelectDialectInput): Promise<ProblemResult> {
    return this.orchestrator.selectDialect(input);
  }

  revise(input: ReviseProblemInput): Promise<ProblemResult> {
    return this.orchestrator.revise(input);
  }

  execute(input: ExecuteProblemInput): Promise<ProblemResult> {
    return this.orchestrator.execute(input);
  }

  cancelExecution(executionId?: string): Promise<ProblemIntelligenceStatus> {
    return this.orchestrator.cancelExecution(executionId);
  }

  resetForSessionStop(): void {
    this.orchestrator.resetForSessionStop();
  }

  dispose(): void {
    this.unsub();
    this.orchestrator.resetForSessionStop();
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }
}
