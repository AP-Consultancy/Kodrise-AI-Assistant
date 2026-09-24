export type TranscriptEventType = 'PARTIAL' | 'FINAL' | 'ERROR' | 'STATUS';

/** Origin of transcript audio — optional for backward compatibility (defaults to microphone). */
export type TranscriptSource = 'microphone' | 'meeting_audio';

export interface TranscriptSegment {
  id: string;
  text: string;
  timestamp: number;
  startTime: number | null;
  endTime: number | null;
  isFinal: boolean;
  confidence: number | null;
  /** Present when Phase 2M multi-source capture is active; omitted/undefined = microphone. */
  source?: TranscriptSource;
}

export interface TranscriptEvent {
  type: TranscriptEventType;
  segment?: TranscriptSegment;
  message?: string;
  timestamp: number;
}

export interface TranscriptSnapshot {
  partialText: string | null;
  partialId: string | null;
  finals: TranscriptSegment[];
  maxFinals: number;
}

export interface TranscriptStatus {
  segmentCount: number;
  hasPartial: boolean;
  maxFinals: number;
}
