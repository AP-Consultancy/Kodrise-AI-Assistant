import type {
  TranscriptEvent,
  TranscriptSegment,
  TranscriptSnapshot,
  TranscriptStatus,
  TranscriptSource,
} from '../../shared/transcription/types';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';

export type TranscriptListener = (event: TranscriptEvent) => void;

export interface TranscriptTiming {
  startTime?: number | null;
  endTime?: number | null;
}

export class TranscriptStore {
  private partials = new Map<TranscriptSource, TranscriptSegment>();
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
    source: TranscriptSource = 'microphone',
  ): TranscriptSegment {
    const now = Date.now();
    const trimmed = text.trim();
    const existing = this.partials.get(source) ?? null;
    const next: TranscriptSegment = existing
      ? {
          ...existing,
          text: trimmed,
          timestamp: now,
          confidence,
          isFinal: false,
          startTime: timing?.startTime ?? existing.startTime,
          endTime: null,
          source,
        }
      : {
          id: this.createId(),
          text: trimmed,
          timestamp: now,
          startTime: timing?.startTime ?? now,
          endTime: null,
          isFinal: false,
          confidence,
          source,
        };
    this.partials.set(source, next);
    this.emit({ type: 'PARTIAL', segment: structuredClone(next), timestamp: now });
    return structuredClone(next);
  }

  commitFinal(
    text: string,
    confidence: number | null = null,
    timing?: TranscriptTiming,
    source: TranscriptSource = 'microphone',
  ): TranscriptSegment | null {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    const last = this.finals[this.finals.length - 1];
    if (
      last &&
      last.text === trimmed &&
      (last.source ?? 'microphone') === source
    ) {
      this.partials.delete(source);
      return structuredClone(last);
    }

    const now = Date.now();
    const existingPartial = this.partials.get(source) ?? null;
    const id = existingPartial?.id ?? this.createId();
    const startTime = timing?.startTime ?? existingPartial?.startTime ?? now;
    const endTime = timing?.endTime ?? now;
    const segment: TranscriptSegment = {
      id,
      text: trimmed,
      timestamp: now,
      startTime,
      endTime,
      isFinal: true,
      confidence,
      source,
    };
    this.partials.delete(source);
    this.finals.push(segment);
    while (this.finals.length > this.maxFinals) {
      this.finals.shift();
    }
    this.emit({ type: 'FINAL', segment: structuredClone(segment), timestamp: now });
    return structuredClone(segment);
  }

  clear(): void {
    this.partials.clear();
    this.finals = [];
    this.emit({ type: 'STATUS', message: 'cleared', timestamp: Date.now() });
  }

  getSnapshot(): TranscriptSnapshot {
    const micPartial = this.partials.get('microphone');
    const meetingPartial = this.partials.get('meeting_audio');
    const partial = meetingPartial ?? micPartial ?? null;
    return {
      partialText: partial?.text ?? null,
      partialId: partial?.id ?? null,
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
      hasPartial: this.partials.size > 0,
      maxFinals: this.maxFinals,
    };
  }

  private emit(event: TranscriptEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
