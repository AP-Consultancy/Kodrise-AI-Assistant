import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import { ContextRecentSchema } from '../../shared/ipc/schemas';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';

export function registerContextIpcHandlers(): void {
  ipcMain.handle(IpcChannels.CONTEXT_GET_CURRENT, (event) =>
    handleIpc(IpcChannels.CONTEXT_GET_CURRENT, event, () =>
      getAppServices().audio.getCurrentContext(),
    ),
  );

  ipcMain.handle(IpcChannels.CONTEXT_GET_RECENT, (event, payload: unknown) =>
    handleIpc(IpcChannels.CONTEXT_GET_RECENT, event, () => {
      const parsed = ContextRecentSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid context recent payload');
      }
      return getAppServices().audio.getRecentContexts(parsed.data?.limit);
    }),
  );

  ipcMain.handle(IpcChannels.CONTEXT_CLEAR, (event) =>
    handleIpc(IpcChannels.CONTEXT_CLEAR, event, () => getAppServices().audio.clearContexts()),
  );

  ipcMain.handle(IpcChannels.CONTEXT_GET_STATUS, (event) =>
    handleIpc(IpcChannels.CONTEXT_GET_STATUS, event, () =>
      getAppServices().audio.getContextStatus(),
    ),
  );
}
