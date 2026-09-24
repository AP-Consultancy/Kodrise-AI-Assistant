import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import { APP_DISPLAY_NAME } from '../../shared/constants';
import type { AppRuntimeInfo, AppVersionInfo } from '../../shared/ipc/types';
import { handleIpc } from './handleIpc';

export function registerAppIpcHandlers(): void {
  ipcMain.handle(IpcChannels.APP_GET_VERSION, (event) =>
    handleIpc(IpcChannels.APP_GET_VERSION, event, (): AppVersionInfo => ({
      version: app.getVersion(),
    })),
  );

  ipcMain.handle(IpcChannels.APP_GET_INFO, (event) =>
    handleIpc(IpcChannels.APP_GET_INFO, event, (): AppRuntimeInfo => ({
      name: APP_DISPLAY_NAME,
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      isPackaged: app.isPackaged,
    })),
  );
}
