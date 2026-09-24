export type TranscriptEventType = 'PARTIAL' | 'FINAL' | 'ERROR' | 'STATUS';

export interface TranscriptSegment {
  id: string;
  text: string;
  timestamp: number;
  startTime: number | null;
  endTime: number | null;
  isFinal: boolean;
  confidence: number | null;
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
