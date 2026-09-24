import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import { TranscriptRecentSchema } from '../../shared/ipc/schemas';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';

export function registerTranscriptIpcHandlers(): void {
  ipcMain.handle(IpcChannels.TRANSCRIPT_GET_RECENT, (event, payload: unknown) =>
    handleIpc(IpcChannels.TRANSCRIPT_GET_RECENT, event, () => {
      const parsed = TranscriptRecentSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid transcript recent payload');
      }
      return getAppServices().audio.getTranscriptRecent(parsed.data?.limit);
    }),
  );

  ipcMain.handle(IpcChannels.TRANSCRIPT_GET_SNAPSHOT, (event) =>
    handleIpc(IpcChannels.TRANSCRIPT_GET_SNAPSHOT, event, () =>
      getAppServices().audio.getTranscriptSnapshot(),
    ),
  );

  ipcMain.handle(IpcChannels.TRANSCRIPT_CLEAR, (event) =>
    handleIpc(IpcChannels.TRANSCRIPT_CLEAR, event, () => getAppServices().audio.clearTranscript()),
  );

  ipcMain.handle(IpcChannels.TRANSCRIPT_GET_STATUS, (event) =>
    handleIpc(IpcChannels.TRANSCRIPT_GET_STATUS, event, () =>
      getAppServices().audio.getTranscriptStatus(),
    ),
  );

  ipcMain.handle(IpcChannels.STT_GET_STATUS, (event) =>
    handleIpc(IpcChannels.STT_GET_STATUS, event, () => getAppServices().audio.getSttStatus()),
  );

  ipcMain.handle(IpcChannels.STT_GET_CONFIG_STATUS, (event) =>
    handleIpc(IpcChannels.STT_GET_CONFIG_STATUS, event, async () =>
      getAppServices().audio.getSttConfigStatus(),
    ),
  );
}
