import { ipcMain, type IpcMainInvokeEvent } from 'electron';

type IpcInvokeListener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

/**
 * Idempotent ipcMain.handle registration.
 * Electron throws if the same channel is registered twice; Vite main HMR /
 * repeated bootstrap must be able to re-bind without aborting later handlers.
 */
export function registerIpcHandle(channel: string, listener: IpcInvokeListener): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}
