import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import type { SystemStatus } from '../../shared/ipc/types';
import { handleIpc } from './handleIpc';

export function registerSystemIpcHandlers(): void {
  ipcMain.handle(IpcChannels.SYSTEM_GET_STATUS, (event) =>
    handleIpc(IpcChannels.SYSTEM_GET_STATUS, event, (): SystemStatus => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: app.getVersion(),
      ipc: 'connected',
    })),
  );
}
