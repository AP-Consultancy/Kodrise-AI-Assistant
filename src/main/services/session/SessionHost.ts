import { BrowserWindow } from 'electron';
import { SessionManager } from '../../../core/session/SessionManager';
import { IpcEvents } from '../../../shared/ipc/channels';
import type { IdGenerator, SessionSnapshot } from '../../../shared/session/types';
import { createDefaultIdGenerator } from '../../../shared/session/types';
import { logger } from '../logging';

export class SessionHost {
  private readonly manager: SessionManager;
  private unsubscribe: (() => void) | null = null;

  constructor(idGenerator: IdGenerator = createDefaultIdGenerator()) {
    this.manager = new SessionManager(idGenerator);
    this.unsubscribe = this.manager.subscribe((event) => {
      if (event.type === 'status-changed') {
        this.broadcast(event.snapshot);
        logger.info('session.status_changed', {
          state: event.snapshot.state,
          sessionId: event.snapshot.sessionId,
          correlationId: event.snapshot.correlationId,
        });
      }
    });
  }

  getManager(): SessionManager {
    return this.manager;
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private broadcast(snapshot: SessionSnapshot): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IpcEvents.SESSION_STATUS_CHANGED, snapshot);
    }
  }
}
