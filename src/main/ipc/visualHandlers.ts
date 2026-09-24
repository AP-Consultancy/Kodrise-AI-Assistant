import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import {
  VisualCaptureNowSchema,
  VisualIntelligenceAnalyzeSchema,
  VisualIntelligenceCancelSchema,
  VisualSetSourceSchema,
} from '../../shared/ipc/schemas';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';

export function registerVisualIpcHandlers(): void {
  ipcMain.handle(IpcChannels.VISUAL_GET_CAPABILITIES, (event) =>
    handleIpc(IpcChannels.VISUAL_GET_CAPABILITIES, event, () =>
      getAppServices().visual.getCapabilities(),
    ),
  );

  ipcMain.handle(IpcChannels.VISUAL_LIST_SOURCES, (event) =>
    handleIpc(IpcChannels.VISUAL_LIST_SOURCES, event, () => getAppServices().visual.listSources()),
  );

  ipcMain.handle(IpcChannels.VISUAL_REQUEST_PERMISSION, (event) =>
    handleIpc(IpcChannels.VISUAL_REQUEST_PERMISSION, event, () =>
      getAppServices().visual.requestPermission(),
    ),
  );

  ipcMain.handle(IpcChannels.VISUAL_GET_STATUS, (event) =>
    handleIpc(IpcChannels.VISUAL_GET_STATUS, event, () => getAppServices().visual.getStatus()),
  );

  ipcMain.handle(IpcChannels.VISUAL_ENABLE, (event) =>
    handleIpc(IpcChannels.VISUAL_ENABLE, event, () => {
      const { visual, config } = getAppServices();
      config.update({ visualContext: { enabled: true } });
      return visual.enable();
    }),
  );

  ipcMain.handle(IpcChannels.VISUAL_DISABLE, (event) =>
    handleIpc(IpcChannels.VISUAL_DISABLE, event, () => {
      const { visual, config } = getAppServices();
      config.update({ visualContext: { enabled: false } });
      return visual.disable();
    }),
  );

  ipcMain.handle(IpcChannels.VISUAL_SET_SOURCE, (event, payload: unknown) =>
    handleIpc(IpcChannels.VISUAL_SET_SOURCE, event, () => {
      const parsed = VisualSetSourceSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid visual source payload');
      }
      const { visual, config } = getAppServices();
      config.update({ visualContext: { source: parsed.data.source } });
      return visual.setSource(parsed.data.source, parsed.data.sourceId ?? null);
    }),
  );

  ipcMain.handle(IpcChannels.VISUAL_START, (event) =>
    handleIpc(IpcChannels.VISUAL_START, event, () => getAppServices().visual.start()),
  );

  ipcMain.handle(IpcChannels.VISUAL_STOP, (event) =>
    handleIpc(IpcChannels.VISUAL_STOP, event, () => getAppServices().visual.stop()),
  );

  ipcMain.handle(IpcChannels.VISUAL_PAUSE, (event) =>
    handleIpc(IpcChannels.VISUAL_PAUSE, event, () => getAppServices().visual.pause()),
  );

  ipcMain.handle(IpcChannels.VISUAL_RESUME, (event) =>
    handleIpc(IpcChannels.VISUAL_RESUME, event, () => getAppServices().visual.resume()),
  );

  ipcMain.handle(IpcChannels.VISUAL_CAPTURE_NOW, (event, payload: unknown) =>
    handleIpc(IpcChannels.VISUAL_CAPTURE_NOW, event, () => {
      const parsed = VisualCaptureNowSchema.safeParse(payload ?? {});
      if (!parsed.success) {
        throw new ValidationError('Invalid visual capture payload');
      }
      return getAppServices().visual.captureNow(parsed.data);
    }),
  );

  ipcMain.handle(IpcChannels.VISUAL_CLEAR, (event) =>
    handleIpc(IpcChannels.VISUAL_CLEAR, event, () => getAppServices().visual.clear()),
  );

  ipcMain.handle(IpcChannels.VISUAL_GET_SNAPSHOT, (event) =>
    handleIpc(IpcChannels.VISUAL_GET_SNAPSHOT, event, () => getAppServices().visual.getSnapshot()),
  );

  ipcMain.handle(IpcChannels.VISUAL_INTELLIGENCE_GET_CAPABILITIES, (event) =>
    handleIpc(IpcChannels.VISUAL_INTELLIGENCE_GET_CAPABILITIES, event, () =>
      getAppServices().visual.getIntelligenceCapabilities(),
    ),
  );

  ipcMain.handle(IpcChannels.VISUAL_INTELLIGENCE_GET_STATUS, (event) =>
    handleIpc(IpcChannels.VISUAL_INTELLIGENCE_GET_STATUS, event, () =>
      getAppServices().visual.getIntelligenceStatus(),
    ),
  );

  ipcMain.handle(IpcChannels.VISUAL_INTELLIGENCE_ANALYZE_CURRENT, (event, payload: unknown) =>
    handleIpc(IpcChannels.VISUAL_INTELLIGENCE_ANALYZE_CURRENT, event, () => {
      const parsed = VisualIntelligenceAnalyzeSchema.safeParse(payload ?? {});
      if (!parsed.success) {
        throw new ValidationError('Invalid visual intelligence analyze payload');
      }
      const { visual, config } = getAppServices();
      if (!config.getPublic().visualIntelligence.enabled) {
        config.update({ visualIntelligence: { enabled: true } });
      }
      return visual.analyzeCurrent(parsed.data?.force ?? true);
    }),
  );

  ipcMain.handle(IpcChannels.VISUAL_INTELLIGENCE_CANCEL, (event, payload: unknown) =>
    handleIpc(IpcChannels.VISUAL_INTELLIGENCE_CANCEL, event, () => {
      const parsed = VisualIntelligenceCancelSchema.safeParse(payload ?? {});
      if (!parsed.success) {
        throw new ValidationError('Invalid visual intelligence cancel payload');
      }
      return getAppServices().visual.cancelIntelligence(parsed.data?.requestId);
    }),
  );

  ipcMain.handle(IpcChannels.VISUAL_INTELLIGENCE_CLEAR_RESULTS, (event) =>
    handleIpc(IpcChannels.VISUAL_INTELLIGENCE_CLEAR_RESULTS, event, () =>
      getAppServices().visual.clearIntelligenceResults(),
    ),
  );
}
