import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';

export function registerSessionIpcHandlers(): void {
  ipcMain.handle(IpcChannels.SESSION_START, (event) =>
    handleIpc(IpcChannels.SESSION_START, event, async () => {
      const { session, audio, visual } = getAppServices();
      audio.setQuestionProcessingEnabled(true);
      await visual.onSessionStart();
      return session.getManager().start();
    }),
  );

  ipcMain.handle(IpcChannels.SESSION_STOP, (event) =>
    handleIpc(IpcChannels.SESSION_STOP, event, async () => {
      const { session, audio, visual } = getAppServices();
      await audio.forceStopFromSession();
      await visual.onSessionStop();
      return session.getManager().stop();
    }),
  );

  ipcMain.handle(IpcChannels.SESSION_PAUSE, (event) =>
    handleIpc(IpcChannels.SESSION_PAUSE, event, async () => {
      const { session, visual } = getAppServices();
      await visual.onSessionPause();
      return session.getManager().pause();
    }),
  );

  ipcMain.handle(IpcChannels.SESSION_RESUME, (event) =>
    handleIpc(IpcChannels.SESSION_RESUME, event, async () => {
      const { session, visual } = getAppServices();
      await visual.onSessionResume();
      return session.getManager().resume();
    }),
  );

  ipcMain.handle(IpcChannels.SESSION_GET_STATUS, (event) =>
    handleIpc(IpcChannels.SESSION_GET_STATUS, event, () => {
      const { session } = getAppServices();
      return session.getManager().getStatus();
    }),
  );
}
