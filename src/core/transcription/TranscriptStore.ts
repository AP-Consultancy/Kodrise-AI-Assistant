import type {
  TranscriptEvent,
  TranscriptSegment,
  TranscriptSnapshot,
  TranscriptStatus,
} from '../../shared/transcription/types';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';

export type TranscriptListener = (event: TranscriptEvent) => void;

export interface TranscriptTiming {
  startTime?: number | null;
  endTime?: number | null;
}

export class TranscriptStore {
  private partial: TranscriptSegment | null = null;
  private finals: TranscriptSegment[] = [];
  private readonly maxFinals: number;
  private readonly createId: IdGenerator;
  private readonly listeners = new Set<TranscriptListener>();

  constructor(options?: { maxFinals?: number; idGenerator?: IdGenerator }) {
    this.maxFinals = options?.maxFinals ?? 200;
    this.createId = options?.idGenerator ?? createDefaultIdGenerator();
  }

  subscribe(listener: TranscriptListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  applyPartial(
    text: string,
    confidence: number | null = null,
    timing?: TranscriptTiming,
  ): TranscriptSegment {
    const now = Date.now();
    const trimmed = text.trim();
    if (this.partial) {
      this.partial = {
        ...this.partial,
        text: trimmed,
        timestamp: now,
        confidence,
        isFinal: false,
        startTime: timing?.startTime ?? this.partial.startTime,
        endTime: null,
      };
    } else {
      this.partial = {
        id: this.createId(),
        text: trimmed,
        timestamp: now,
        startTime: timing?.startTime ?? now,
        endTime: null,
        isFinal: false,
        confidence,
      };
    }
    this.emit({ type: 'PARTIAL', segment: structuredClone(this.partial), timestamp: now });
    return structuredClone(this.partial);
  }

  commitFinal(
    text: string,
    confidence: number | null = null,
    timing?: TranscriptTiming,
  ): TranscriptSegment | null {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    const last = this.finals[this.finals.length - 1];
    if (last && last.text === trimmed) {
      this.partial = null;
      return structuredClone(last);
    }

    const now = Date.now();
    const id = this.partial?.id ?? this.createId();
    const startTime = timing?.startTime ?? this.partial?.startTime ?? now;
    const endTime = timing?.endTime ?? now;
    const segment: TranscriptSegment = {
      id,
      text: trimmed,
      timestamp: now,
      startTime,
      endTime,
      isFinal: true,
      confidence,
    };
    this.partial = null;
    this.finals.push(segment);
    while (this.finals.length > this.maxFinals) {
      this.finals.shift();
    }
    this.emit({ type: 'FINAL', segment: structuredClone(segment), timestamp: now });
    return structuredClone(segment);
  }

  clear(): void {
    this.partial = null;
    this.finals = [];
    this.emit({ type: 'STATUS', message: 'cleared', timestamp: Date.now() });
  }

  getSnapshot(): TranscriptSnapshot {
    return {
      partialText: this.partial?.text ?? null,
      partialId: this.partial?.id ?? null,
      finals: this.finals.map((segment) => structuredClone(segment)),
      maxFinals: this.maxFinals,
    };
  }

  getRecent(limit = 50): TranscriptSegment[] {
    return this.finals.slice(-limit).map((segment) => structuredClone(segment));
  }

  getStatus(): TranscriptStatus {
    return {
      segmentCount: this.finals.length,
      hasPartial: Boolean(this.partial),
      maxFinals: this.maxFinals,
    };
  }

  private emit(event: TranscriptEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
