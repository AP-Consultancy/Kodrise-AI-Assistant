import type { VisualFrame } from '../../shared/visual-context/types';

export class VisualFrameDeduplicator {
  isDuplicate(candidate: VisualFrame, existing: VisualFrame[]): boolean {
    return existing.some((frame) => frame.contentHash === candidate.contentHash);
  }
}
