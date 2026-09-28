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
        const issues = parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        );
        throw new ValidationError(
          issues[0] ? `Invalid config update: ${issues[0]}` : 'Invalid config update payload',
          { issues },
        );
      }
      const { config } = getAppServices();
      return config.update(parsed.data);
    }),
  );
}
