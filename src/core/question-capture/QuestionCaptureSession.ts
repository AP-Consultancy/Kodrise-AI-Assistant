import type { CapturedQuestion } from '../../shared/question-capture/types';

const MAX_HISTORY = 30;

/**
 * Bounded captured-question history for follow-ups / revisions.
 */
export class QuestionCaptureSession {
  private readonly history: CapturedQuestion[] = [];
  private selectedQuestionIndex: number | null = null;

  getPrevious(): CapturedQuestion | null {
    return this.history[this.history.length - 1] ?? null;
  }

  push(question: CapturedQuestion): void {
    this.history.push(question);
    while (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }
    this.selectedQuestionIndex = null;
  }

  list(): CapturedQuestion[] {
    return [...this.history];
  }

  setSelectedMultipleIndex(index: number | null): void {
    this.selectedQuestionIndex = index;
  }

  getSelectedMultipleIndex(): number | null {
    return this.selectedQuestionIndex;
  }

  reset(): void {
    this.history.length = 0;
    this.selectedQuestionIndex = null;
  }
}
