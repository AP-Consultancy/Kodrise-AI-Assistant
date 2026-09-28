import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels, IpcEvents } from '../../shared/ipc/channels';
import { handleIpc } from './handleIpc';

function windowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

/**
 * Frameless window controls — typed IPC only, no Node exposure to renderer.
 */
export function registerWindowIpcHandlers(): void {
  ipcMain.handle(IpcChannels.WINDOW_MINIMIZE, (event) =>
    handleIpc(IpcChannels.WINDOW_MINIMIZE, event, () => {
      windowFromEvent(event)?.minimize();
      return { ok: true as const };
    }),
  );

  ipcMain.handle(IpcChannels.WINDOW_MAXIMIZE, (event) =>
    handleIpc(IpcChannels.WINDOW_MAXIMIZE, event, () => {
      const win = windowFromEvent(event);
      if (!win) return { maximized: false };
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
      return { maximized: win.isMaximized() };
    }),
  );

  ipcMain.handle(IpcChannels.WINDOW_CLOSE, (event) =>
    handleIpc(IpcChannels.WINDOW_CLOSE, event, () => {
      windowFromEvent(event)?.close();
      return { ok: true as const };
    }),
  );

  ipcMain.handle(IpcChannels.WINDOW_IS_MAXIMIZED, (event) =>
    handleIpc(IpcChannels.WINDOW_IS_MAXIMIZED, event, () => {
      const win = windowFromEvent(event);
      return { maximized: win?.isMaximized() ?? false };
    }),
  );
}

/** Wire maximize state events for a specific BrowserWindow. */
export function bindWindowMaximizeEvents(mainWindow: BrowserWindow): void {
  const emit = () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcEvents.WINDOW_MAXIMIZED_CHANGED, {
        maximized: mainWindow.isMaximized(),
      });
    }
  };
  mainWindow.on('maximize', emit);
  mainWindow.on('unmaximize', emit);
}
