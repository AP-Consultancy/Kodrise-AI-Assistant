import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import {
  AudioCaptureErrorSchema,
  AudioChunkDtoSchema,
  AudioDevicesPayloadSchema,
  AudioPermissionSchema,
  AudioSelectDeviceSchema,
  AudioStartSchema,
} from '../../shared/ipc/schemas';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';

export function registerAudioIpcHandlers(): void {
  ipcMain.handle(IpcChannels.AUDIO_GET_DEVICES, (event) =>
    handleIpc(IpcChannels.AUDIO_GET_DEVICES, event, () => getAppServices().audio.getDevices()),
  );

  ipcMain.handle(IpcChannels.AUDIO_SET_DEVICES, (event, payload: unknown) =>
    handleIpc(IpcChannels.AUDIO_SET_DEVICES, event, () => {
      const parsed = AudioDevicesPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid audio devices payload');
      }
      getAppServices().audio.setDevices(parsed.data.devices);
      return getAppServices().audio.getDevices();
    }),
  );

  ipcMain.handle(IpcChannels.AUDIO_SELECT_DEVICE, (event, payload: unknown) =>
    handleIpc(IpcChannels.AUDIO_SELECT_DEVICE, event, () => {
      const parsed = AudioSelectDeviceSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid audio device selection');
      }
      return getAppServices().audio.selectDevice(parsed.data.deviceId);
    }),
  );

  ipcMain.handle(IpcChannels.AUDIO_BEGIN_PERMISSION, (event) =>
    handleIpc(IpcChannels.AUDIO_BEGIN_PERMISSION, event, () =>
      getAppServices().audio.beginPermissionRequest(),
    ),
  );

  ipcMain.handle(IpcChannels.AUDIO_SET_PERMISSION, (event, payload: unknown) =>
    handleIpc(IpcChannels.AUDIO_SET_PERMISSION, event, () => {
      const parsed = AudioPermissionSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid audio permission payload');
      }
      return getAppServices().audio.setPermission(parsed.data.permission);
    }),
  );

  ipcMain.handle(IpcChannels.AUDIO_GET_STATUS, (event) =>
    handleIpc(IpcChannels.AUDIO_GET_STATUS, event, () => getAppServices().audio.getAudioStatus()),
  );

  ipcMain.handle(IpcChannels.AUDIO_START, (event, payload: unknown) =>
    handleIpc(IpcChannels.AUDIO_START, event, async () => {
      const parsed = AudioStartSchema.safeParse(payload ?? {});
      if (!parsed.success) {
        throw new ValidationError('Invalid audio start payload');
      }
      return getAppServices().audio.start(parsed.data);
    }),
  );

  ipcMain.handle(IpcChannels.AUDIO_CONFIRM_ACTIVE, (event) =>
    handleIpc(IpcChannels.AUDIO_CONFIRM_ACTIVE, event, () =>
      getAppServices().audio.confirmActive(),
    ),
  );

  ipcMain.handle(IpcChannels.AUDIO_PAUSE, (event) =>
    handleIpc(IpcChannels.AUDIO_PAUSE, event, async () => getAppServices().audio.pause()),
  );

  ipcMain.handle(IpcChannels.AUDIO_RESUME, (event) =>
    handleIpc(IpcChannels.AUDIO_RESUME, event, async () => getAppServices().audio.resume()),
  );

  ipcMain.handle(IpcChannels.AUDIO_STOP, (event) =>
    handleIpc(IpcChannels.AUDIO_STOP, event, async () => getAppServices().audio.stop()),
  );

  ipcMain.handle(IpcChannels.AUDIO_PUSH_CHUNK, (event, payload: unknown) =>
    handleIpc(IpcChannels.AUDIO_PUSH_CHUNK, event, async () => {
      const parsed = AudioChunkDtoSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid audio chunk payload');
      }
      await getAppServices().audio.ingestChunk(parsed.data);
      return { accepted: true as const };
    }),
  );

  ipcMain.handle(IpcChannels.AUDIO_CAPTURE_ERROR, (event, payload: unknown) =>
    handleIpc(IpcChannels.AUDIO_CAPTURE_ERROR, event, () => {
      const parsed = AudioCaptureErrorSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid audio error payload');
      }
      return getAppServices().audio.markCaptureError(parsed.data.message);
    }),
  );
}
