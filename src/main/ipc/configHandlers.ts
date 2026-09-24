import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import { PublicConfigUpdateSchema } from '../../core/configuration/schema';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';

export function registerConfigIpcHandlers(): void {
  ipcMain.handle(IpcChannels.CONFIG_GET_PUBLIC, (event) =>
    handleIpc(IpcChannels.CONFIG_GET_PUBLIC, event, () => {
      const { config } = getAppServices();
      return config.getPublic();
    }),
  );

  ipcMain.handle(IpcChannels.CONFIG_UPDATE, (event, payload: unknown) =>
    handleIpc(IpcChannels.CONFIG_UPDATE, event, () => {
      const parsed = PublicConfigUpdateSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid config update payload', {
          issues: parsed.error.issues.map((issue) => issue.message),
        });
      }
      const { config } = getAppServices();
      return config.update(parsed.data);
    }),
  );
}
