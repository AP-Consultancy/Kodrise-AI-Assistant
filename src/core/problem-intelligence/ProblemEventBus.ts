import type { ProblemEvent, ProblemEventType } from '../../shared/problem-intelligence/types';

export type ProblemEventListener = (event: ProblemEvent) => void;

/**
 * Typed per-service event bus (same pattern as AI/Context listeners).
 */
export class ProblemEventBus {
  private readonly listeners = new Set<ProblemEventListener>();

  subscribe(listener: ProblemEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(type: ProblemEventType, problemId: string, payload?: Record<string, unknown>): ProblemEvent {
    const event: ProblemEvent = {
      type,
      problemId,
      timestamp: Date.now(),
      payload,
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // isolate listener failures
      }
    }
    return event;
  }
}
