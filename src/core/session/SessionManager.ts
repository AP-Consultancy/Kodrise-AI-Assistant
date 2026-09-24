import { SessionError } from '../../shared/errors';
import {
  createDefaultIdGenerator,
  type IdGenerator,
  type SessionListener,
  type SessionSnapshot,
  type SessionState,
} from '../../shared/session/types';

const ALLOWED_TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  idle: ['starting'],
  starting: ['active', 'error', 'stopping'],
  active: ['pausing', 'stopping', 'error'],
  pausing: ['active', 'stopping', 'error'],
  stopping: ['idle', 'error'],
  error: ['idle', 'starting'],
};

function createEmptySnapshot(): SessionSnapshot {
  return {
    sessionId: null,
    correlationId: null,
    state: 'idle',
    startedAt: null,
    stoppedAt: null,
    errorMessage: null,
  };
}

export class SessionManager {
  private snapshot: SessionSnapshot = createEmptySnapshot();
  private readonly listeners = new Set<SessionListener>();
  private readonly createId: IdGenerator;

  constructor(idGenerator: IdGenerator = createDefaultIdGenerator()) {
    this.createId = idGenerator;
  }

  getStatus(): SessionSnapshot {
    return structuredClone(this.snapshot);
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<SessionSnapshot> {
    this.transition('starting');
    this.snapshot = {
      ...this.snapshot,
      sessionId: this.createId(),
      correlationId: this.createId(),
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      errorMessage: null,
    };
    this.emit();

    // Foundation phase: no AI/capture wiring — become active immediately.
    this.transition('active');
    return this.getStatus();
  }

  async stop(): Promise<SessionSnapshot> {
    if (this.snapshot.state === 'idle') {
      return this.getStatus();
    }

    if (this.snapshot.state !== 'stopping' && this.snapshot.state !== 'error') {
      this.transition('stopping');
    } else if (this.snapshot.state === 'error') {
      this.transition('idle');
      this.snapshot = {
        ...createEmptySnapshot(),
        stoppedAt: new Date().toISOString(),
      };
      this.emit();
      return this.getStatus();
    }

    const stoppedAt = new Date().toISOString();
    this.transition('idle');
    this.snapshot = {
      ...createEmptySnapshot(),
      stoppedAt,
    };
    this.emit();
    return this.getStatus();
  }

  markError(message: string): SessionSnapshot {
    this.transition('error');
    this.snapshot = {
      ...this.snapshot,
      errorMessage: message,
    };
    this.emit();
    return this.getStatus();
  }

  pause(): SessionSnapshot {
    this.transition('pausing');
    return this.getStatus();
  }

  resume(): SessionSnapshot {
    if (this.snapshot.state !== 'pausing') {
      throw new SessionError(`Cannot resume from state "${this.snapshot.state}"`);
    }
    this.transition('active');
    return this.getStatus();
  }

  private transition(next: SessionState): void {
    const current = this.snapshot.state;
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new SessionError(`Invalid session transition: ${current} → ${next}`, {
        from: current,
        to: next,
      });
    }

    this.snapshot = {
      ...this.snapshot,
      state: next,
      errorMessage: next === 'error' ? this.snapshot.errorMessage : null,
    };
    this.emit();
  }

  private emit(): void {
    const event = { type: 'status-changed' as const, snapshot: this.getStatus() };
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
