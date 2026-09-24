import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import { CaptureApplyPolicySchema } from '../../shared/ipc/schemas';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';

export function registerCapturePolicyIpcHandlers(): void {
  ipcMain.handle(IpcChannels.CAPTURE_GET_PLATFORM, (event) =>
    handleIpc(IpcChannels.CAPTURE_GET_PLATFORM, event, () =>
      getAppServices().capturePolicy.getPlatform(),
    ),
  );

  ipcMain.handle(IpcChannels.CAPTURE_GET_CAPABILITIES, (event) =>
    handleIpc(IpcChannels.CAPTURE_GET_CAPABILITIES, event, () =>
      getAppServices().capturePolicy.getCapabilities(),
    ),
  );

  ipcMain.handle(IpcChannels.CAPTURE_GET_STATUS, (event) =>
    handleIpc(IpcChannels.CAPTURE_GET_STATUS, event, () =>
      getAppServices().capturePolicy.getStatus(),
    ),
  );

  ipcMain.handle(IpcChannels.CAPTURE_GET_POLICY, (event) =>
    handleIpc(IpcChannels.CAPTURE_GET_POLICY, event, () =>
      getAppServices().capturePolicy.getPolicy(),
    ),
  );

  ipcMain.handle(IpcChannels.CAPTURE_APPLY_POLICY, (event, payload: unknown) =>
    handleIpc(IpcChannels.CAPTURE_APPLY_POLICY, event, () => {
      const parsed = CaptureApplyPolicySchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid capture policy payload');
      }
      return getAppServices().capturePolicy.applyPolicy(parsed.data.policy);
    }),
  );

  ipcMain.handle(IpcChannels.CAPTURE_RESET_POLICY, (event) =>
    handleIpc(IpcChannels.CAPTURE_RESET_POLICY, event, () =>
      getAppServices().capturePolicy.resetPolicy(),
    ),
  );

  ipcMain.handle(IpcChannels.CAPTURE_GET_HARNESS, (event) =>
    handleIpc(IpcChannels.CAPTURE_GET_HARNESS, event, () =>
      getAppServices().capturePolicy.getHarnessSnapshot(),
    ),
  );
}
