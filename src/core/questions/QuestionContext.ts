import type { DetectedQuestion } from '../../shared/questions/types';
import type { TranscriptSegment } from '../../shared/transcription/types';
import { QUESTION_BUFFER } from '../../shared/questions/types';

export class QuestionContext {
  private recentSegments: TranscriptSegment[] = [];
  private recentQuestions: DetectedQuestion[] = [];
  private lastQuestion: DetectedQuestion | null = null;
  private readonly maxSegments: number;
  private readonly maxQuestions: number;

  constructor(options?: { maxSegments?: number; maxQuestions?: number }) {
    this.maxSegments = options?.maxSegments ?? QUESTION_BUFFER.MAX_CONTEXT_SEGMENTS;
    this.maxQuestions = options?.maxQuestions ?? QUESTION_BUFFER.MAX_RECENT_QUESTIONS;
  }

  addSegment(segment: TranscriptSegment): void {
    this.recentSegments.push(segment);
    while (this.recentSegments.length > this.maxSegments) {
      this.recentSegments.shift();
    }
  }

  addQuestion(question: DetectedQuestion): void {
    this.recentQuestions.push(question);
    this.lastQuestion = question;
    while (this.recentQuestions.length > this.maxQuestions) {
      this.recentQuestions.shift();
    }
  }

  replaceQuestion(question: DetectedQuestion): void {
    const index = this.recentQuestions.findIndex((item) => item.id === question.id);
    if (index >= 0) {
      this.recentQuestions[index] = question;
    } else {
      this.recentQuestions.push(question);
      while (this.recentQuestions.length > this.maxQuestions) {
        this.recentQuestions.shift();
      }
    }
    if (this.lastQuestion?.id === question.id || !this.lastQuestion) {
      this.lastQuestion = question;
    }
  }

  getLastQuestion(): DetectedQuestion | null {
    return this.lastQuestion;
  }

  getRecentQuestions(): DetectedQuestion[] {
    return this.recentQuestions.map((question) => structuredClone(question));
  }

  hasRecentQuestion(): boolean {
    return this.lastQuestion !== null;
  }

  clear(): void {
    this.recentSegments = [];
    this.recentQuestions = [];
    this.lastQuestion = null;
  }
}
