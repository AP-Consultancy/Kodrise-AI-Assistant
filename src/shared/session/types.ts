export type SessionState = 'idle' | 'starting' | 'active' | 'pausing' | 'stopping' | 'error';

export interface SessionSnapshot {
  sessionId: string | null;
  correlationId: string | null;
  state: SessionState;
  startedAt: string | null;
  stoppedAt: string | null;
  errorMessage: string | null;
}

export type SessionEvent = { type: 'status-changed'; snapshot: SessionSnapshot };

export type SessionListener = (event: SessionEvent) => void;

export type IdGenerator = () => string;

export function createDefaultIdGenerator(): IdGenerator {
  return () => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };
}
