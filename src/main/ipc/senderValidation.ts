import { app, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { AuthorizationError } from '../../shared/errors';
import { isTrustedIpcOrigin } from './originPolicy';

export { isTrustedIpcOrigin } from './originPolicy';

/**
 * Defense-in-depth IPC sender checks.
 * Dev: allow Vite localhost + file://
 * Prod: allow file:// from application windows only
 */
export function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const sender = event.sender;
  const owned = BrowserWindow.getAllWindows().some(
    (window) => window.webContents.id === sender.id,
  );
  if (!owned) {
    throw new AuthorizationError('IPC sender is not an application window');
  }

  let url = '';
  try {
    url = sender.getURL();
  } catch {
    throw new AuthorizationError('Unable to resolve IPC sender URL');
  }

  if (!isTrustedIpcOrigin(url, app.isPackaged)) {
    throw new AuthorizationError(
      app.isPackaged
        ? 'Untrusted IPC origin in production'
        : 'Untrusted IPC origin in development',
    );
  }
}
