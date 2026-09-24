import { describe, expect, it } from 'vitest';
import { SessionManager } from '../../src/core/session/SessionManager';
import { SessionError } from '../../src/shared/errors';

describe('SessionManager', () => {
  it('transitions idle → starting → active on start', async () => {
    let n = 0;
    const manager = new SessionManager(() => `id-${++n}`);
    const snapshot = await manager.start();
    expect(snapshot.state).toBe('active');
    expect(snapshot.sessionId).toBe('id-1');
    expect(snapshot.correlationId).toBe('id-2');
  });

  it('returns to idle on stop', async () => {
    const manager = new SessionManager(() => 'fixed-id');
    await manager.start();
    const stopped = await manager.stop();
    expect(stopped.state).toBe('idle');
    expect(stopped.sessionId).toBeNull();
  });

  it('supports pause and resume', async () => {
    const manager = new SessionManager(() => 'id');
    await manager.start();
    expect(manager.pause().state).toBe('pausing');
    expect(manager.resume().state).toBe('active');
  });

  it('rejects invalid transitions', () => {
    const manager = new SessionManager(() => 'id');
    expect(() => manager.pause()).toThrow(SessionError);
  });
});
