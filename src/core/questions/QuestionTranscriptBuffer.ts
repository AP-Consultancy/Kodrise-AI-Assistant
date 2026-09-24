import type { TranscriptSegment } from '../../shared/transcription/types';
import { QUESTION_BUFFER } from '../../shared/questions/types';

export interface BufferedUtterance {
  text: string;
  sourceSegmentIds: string[];
  timestamp: number;
  complete: boolean;
}

/**
 * Combines closely related FINAL transcript segments before question detection.
 */
export class QuestionTranscriptBuffer {
  private pending: TranscriptSegment[] = [];
  private readonly maxPending: number;
  private readonly maxGapMs: number;
  private readonly maxCombinedChars: number;

  constructor(options?: {
    maxPending?: number;
    maxGapMs?: number;
    maxCombinedChars?: number;
  }) {
    this.maxPending = options?.maxPending ?? QUESTION_BUFFER.MAX_PENDING_SEGMENTS;
    this.maxGapMs = options?.maxGapMs ?? QUESTION_BUFFER.MAX_GAP_MS;
    this.maxCombinedChars = options?.maxCombinedChars ?? QUESTION_BUFFER.MAX_COMBINED_CHARS;
  }

  /**
   * Push a final segment. Returns zero or more ready utterances to process.
   */
  push(segment: TranscriptSegment): BufferedUtterance[] {
    const ready: BufferedUtterance[] = [];
    const incoming = segment.text.trim();
    if (!incoming) {
      return ready;
    }

    if (this.pending.length > 0) {
      const last = this.pending[this.pending.length - 1]!;
      const gap = segment.timestamp - last.timestamp;
      const combined = this.combinedText();

      // Progressive STT often re-sends a longer version of the same utterance.
      // Replace pending instead of concatenating duplicates.
      if (this.isProgressiveExtension(combined, incoming)) {
        const keepText = incoming.length >= combined.length ? incoming : combined;
        this.pending = [
          {
            ...segment,
            text: keepText,
            startTime: this.pending[0]?.startTime ?? segment.startTime,
            endTime: segment.endTime ?? last.endTime,
          },
        ];
        if (this.looksComplete(this.combinedText())) {
          ready.push(...this.flush());
        }
        return ready;
      }

      const combinedLength = combined.length + incoming.length + 1;
      if (gap > this.maxGapMs || combinedLength > this.maxCombinedChars) {
        ready.push(...this.flush());
      }
    }

    this.pending.push(segment);

    if (this.pending.length > this.maxPending) {
      ready.push(...this.flush());
      return ready;
    }

    if (this.looksComplete(this.combinedText())) {
      ready.push(...this.flush());
    }

    return ready;
  }

  flush(): BufferedUtterance[] {
    if (this.pending.length === 0) {
      return [];
    }
    const text = this.combinedText();
    const utterance: BufferedUtterance = {
      text,
      sourceSegmentIds: this.pending.map((segment) => segment.id).filter(Boolean),
      timestamp: this.pending[this.pending.length - 1]!.timestamp,
      complete: this.looksComplete(text),
    };
    this.pending = [];
    return [utterance];
  }

  clear(): void {
    this.pending = [];
  }

  private combinedText(): string {
    return this.pending
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isProgressiveExtension(a: string, b: string): boolean {
    const left = this.tokens(a);
    const right = this.tokens(b);
    if (left.length < 3 || right.length < 3) {
      return false;
    }
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length <= right.length ? right : left;
    for (let i = 0; i < shorter.length; i += 1) {
      if (shorter[i] !== longer[i]) {
        return false;
      }
    }
    return true;
  }

  private tokens(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1);
  }

  private looksComplete(text: string): boolean {
    if (!text) {
      return false;
    }
    if (/[.!?]$/.test(text)) {
      return true;
    }
    // Incomplete stems like "Can you explain" wait for more.
    if (
      /^(can|could|would|will|do|did|please)?\s*(you\s+)?(explain|describe|tell|walk|talk)\s*$/i.test(
        text,
      )
    ) {
      return false;
    }
    // Without terminal punctuation, require a fuller utterance so progressive
    // STT chunks ("Can you tell me what") are not flushed early.
    if (
      /\b(can you|could you|how did|how would|what is|why did|tell me)\b/i.test(text) &&
      text.split(/\s+/).length >= 8
    ) {
      return true;
    }
    return text.split(/\s+/).length >= 12;
  }
}
