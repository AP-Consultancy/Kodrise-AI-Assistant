import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import { AICancelSchema, AIGenerateSchema } from '../../shared/ipc/schemas';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';

export function registerAiIpcHandlers(): void {
  ipcMain.handle(IpcChannels.AI_GET_STATUS, (event) =>
    handleIpc(IpcChannels.AI_GET_STATUS, event, () => getAppServices().audio.getAiStatus()),
  );

  ipcMain.handle(IpcChannels.AI_GET_CONFIGURATION, (event) =>
    handleIpc(IpcChannels.AI_GET_CONFIGURATION, event, () =>
      getAppServices().audio.getAiConfigStatus(),
    ),
  );

  ipcMain.handle(IpcChannels.AI_GENERATE, (event, payload: unknown) =>
    handleIpc(IpcChannels.AI_GENERATE, event, () => {
      const parsed = AIGenerateSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid AI generate payload');
      }
      return getAppServices().audio.generateAiAnswer(parsed.data.questionId);
    }),
  );

  ipcMain.handle(IpcChannels.AI_CANCEL, (event, payload: unknown) =>
    handleIpc(IpcChannels.AI_CANCEL, event, () => {
      const parsed = AICancelSchema.safeParse(payload ?? {});
      if (!parsed.success) {
        throw new ValidationError('Invalid AI cancel payload');
      }
      return getAppServices().audio.cancelAi(parsed.data?.requestId);
    }),
  );

  ipcMain.handle(IpcChannels.AI_CLEAR_RESPONSE, (event) =>
    handleIpc(IpcChannels.AI_CLEAR_RESPONSE, event, () =>
      getAppServices().audio.clearAiResponses(),
    ),
  );

  ipcMain.handle(IpcChannels.AI_GET_CURRENT_RESPONSE, (event) =>
    handleIpc(IpcChannels.AI_GET_CURRENT_RESPONSE, event, () =>
      getAppServices().audio.getCurrentAiResponse(),
    ),
  );
}
