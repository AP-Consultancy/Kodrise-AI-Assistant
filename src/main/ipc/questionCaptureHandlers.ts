import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import {
  QuestionCaptureSelectSchema,
  QuestionCaptureUpdateSchema,
} from '../../shared/ipc/schemas';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';

export function registerQuestionCaptureIpcHandlers(): void {
  ipcMain.handle(IpcChannels.QUESTION_CAPTURE_GET_STATUS, (event) =>
    handleIpc(IpcChannels.QUESTION_CAPTURE_GET_STATUS, event, () =>
      getAppServices().questionCapture.getStatus(),
    ),
  );

  ipcMain.handle(IpcChannels.QUESTION_CAPTURE_UPDATE_CONFIG, (event, payload: unknown) =>
    handleIpc(IpcChannels.QUESTION_CAPTURE_UPDATE_CONFIG, event, () => {
      const parsed = QuestionCaptureUpdateSchema.safeParse(payload ?? {});
      if (!parsed.success) throw new ValidationError('Invalid question capture config');
      return getAppServices().questionCapture.updateConfig(parsed.data);
    }),
  );

  ipcMain.handle(IpcChannels.QUESTION_CAPTURE_START, (event) =>
    handleIpc(IpcChannels.QUESTION_CAPTURE_START, event, () =>
      getAppServices().questionCapture.startCapture(),
    ),
  );

  ipcMain.handle(IpcChannels.QUESTION_CAPTURE_CANCEL, (event) =>
    handleIpc(IpcChannels.QUESTION_CAPTURE_CANCEL, event, () =>
      getAppServices().questionCapture.cancel(),
    ),
  );

  ipcMain.handle(IpcChannels.QUESTION_CAPTURE_SELECT_QUESTION, (event, payload: unknown) =>
    handleIpc(IpcChannels.QUESTION_CAPTURE_SELECT_QUESTION, event, () => {
      const parsed = QuestionCaptureSelectSchema.safeParse(payload);
      if (!parsed.success) throw new ValidationError('Invalid question selection');
      return getAppServices().questionCapture.selectMultipleQuestion(parsed.data.index);
    }),
  );

  ipcMain.handle(IpcChannels.QUESTION_CAPTURE_REGISTER_HOTKEY, (event) =>
    handleIpc(IpcChannels.QUESTION_CAPTURE_REGISTER_HOTKEY, event, () =>
      getAppServices().questionCapture.registerHotkey(),
    ),
  );
}
