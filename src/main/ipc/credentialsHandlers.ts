import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import { CredentialsKeySchema, CredentialsSetSchema } from '../../shared/ipc/schemas';
import { ValidationError } from '../../shared/errors';
import type { CredentialStatus } from '../../shared/ipc/types';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';

function toStatus(key: string, configured: boolean): CredentialStatus {
  const { credentials } = getAppServices();
  return {
    key,
    configured,
    storage: credentials.getStorageState(),
  };
}

export function registerCredentialsIpcHandlers(): void {
  ipcMain.handle(IpcChannels.CREDENTIALS_HAS, (event, payload: unknown) =>
    handleIpc(IpcChannels.CREDENTIALS_HAS, event, async (): Promise<CredentialStatus> => {
      const parsed = CredentialsKeySchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid credentials key payload');
      }
      const { credentials } = getAppServices();
      const configured = await credentials.hasCredential(parsed.data.key);
      return toStatus(parsed.data.key, configured);
    }),
  );

  ipcMain.handle(IpcChannels.CREDENTIALS_SET, (event, payload: unknown) =>
    handleIpc(IpcChannels.CREDENTIALS_SET, event, async (): Promise<CredentialStatus> => {
      const parsed = CredentialsSetSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid credentials set payload');
      }
      const { credentials } = getAppServices();
      await credentials.setCredential(parsed.data.key, parsed.data.value);
      return toStatus(parsed.data.key, true);
    }),
  );

  ipcMain.handle(IpcChannels.CREDENTIALS_DELETE, (event, payload: unknown) =>
    handleIpc(IpcChannels.CREDENTIALS_DELETE, event, async (): Promise<CredentialStatus> => {
      const parsed = CredentialsKeySchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid credentials delete payload');
      }
      const { credentials } = getAppServices();
      await credentials.deleteCredential(parsed.data.key);
      return toStatus(parsed.data.key, false);
    }),
  );
}
