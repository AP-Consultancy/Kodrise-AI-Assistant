import type { TranscriptSegment } from '../../shared/transcription/types';
import type { ContextBudget } from '../../shared/context/types';
import { DEFAULT_CONTEXT_BUDGET } from '../../shared/context/types';

export interface TranscriptWindowResult {
  segments: TranscriptSegment[];
  omittedCount: number;
  characterCount: number;
}

/**
 * Selects a bounded recent transcript window (most recent priority).
 */
export class TranscriptContextProvider {
  selectRecent(
    segments: TranscriptSegment[],
    budget: ContextBudget = DEFAULT_CONTEXT_BUDGET,
  ): TranscriptWindowResult {
    const recent = segments.slice(-Math.max(budget.maxTranscriptSegments * 2, budget.maxTranscriptSegments));
    const selected: TranscriptSegment[] = [];
    let characters = 0;
    let omitted = 0;

    for (let index = recent.length - 1; index >= 0; index -= 1) {
      const segment = recent[index]!;
      const nextChars = characters + segment.text.length;
      if (
        selected.length >= budget.maxTranscriptSegments ||
        nextChars > budget.maxTranscriptCharacters
      ) {
        omitted += 1;
        continue;
      }
      selected.unshift(structuredClone(segment));
      characters = nextChars;
    }

    // Count segments that never entered the candidate window.
    omitted += Math.max(0, segments.length - recent.length);

    return {
      segments: selected,
      omittedCount: omitted,
      characterCount: characters,
    };
  }
}
