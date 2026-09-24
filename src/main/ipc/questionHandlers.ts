import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import { QuestionRecentSchema } from '../../shared/ipc/schemas';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';

export function registerQuestionIpcHandlers(): void {
  ipcMain.handle(IpcChannels.QUESTION_GET_RECENT, (event, payload: unknown) =>
    handleIpc(IpcChannels.QUESTION_GET_RECENT, event, () => {
      const parsed = QuestionRecentSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid question recent payload');
      }
      return getAppServices().audio.getRecentQuestions(parsed.data?.limit);
    }),
  );

  ipcMain.handle(IpcChannels.QUESTION_GET_CURRENT, (event) =>
    handleIpc(IpcChannels.QUESTION_GET_CURRENT, event, () =>
      getAppServices().audio.getCurrentQuestion(),
    ),
  );

  ipcMain.handle(IpcChannels.QUESTION_CLEAR, (event) =>
    handleIpc(IpcChannels.QUESTION_CLEAR, event, () => getAppServices().audio.clearQuestions()),
  );

  ipcMain.handle(IpcChannels.QUESTION_GET_STATUS, (event) =>
    handleIpc(IpcChannels.QUESTION_GET_STATUS, event, () =>
      getAppServices().audio.getQuestionPipelineStatus(),
    ),
  );
}
