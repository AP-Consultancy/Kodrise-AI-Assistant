import type { DetectedQuestion } from '../../shared/questions/types';
import type { TranscriptSegment } from '../../shared/transcription/types';

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deterministic deduplication preserving first (higher-priority) occurrence.
 */
export class ContextDeduplicator {
  dedupeTranscript(segments: TranscriptSegment[]): TranscriptSegment[] {
    const seen = new Set<string>();
    const output: TranscriptSegment[] = [];
    for (const segment of segments) {
      const key = normalizeKey(segment.text);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push(segment);
    }
    return output;
  }

  dedupeQuestions(questions: DetectedQuestion[]): DetectedQuestion[] {
    const seen = new Set<string>();
    const output: DetectedQuestion[] = [];
    for (const question of questions) {
      const key = normalizeKey(question.normalizedText || question.text);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push(question);
    }
    return output;
  }

  /**
   * Drop transcript segments whose text is already covered by question text.
   */
  removeTranscriptCoveredByQuestions(
    segments: TranscriptSegment[],
    questions: DetectedQuestion[],
  ): TranscriptSegment[] {
    const questionKeys = new Set(
      questions.map((question) => normalizeKey(question.normalizedText || question.text)),
    );
    return segments.filter((segment) => {
      const key = normalizeKey(segment.text);
      return key.length > 0 && !questionKeys.has(key);
    });
  }
}
