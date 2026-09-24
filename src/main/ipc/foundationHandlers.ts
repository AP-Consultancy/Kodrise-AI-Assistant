import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import { ClientSecurityReportSchema } from '../../shared/ipc/schemas';
import type {
  ClientSecurityReport,
  FoundationCheckItem,
  FoundationDiagnostics,
} from '../../shared/ipc/types';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';
import { APP_DISPLAY_NAME } from '../../shared/constants';
import { getLogDirectory } from '../services/logging';
import { buildFoundationChecks } from './foundationChecks';

export function registerFoundationIpcHandlers(): void {
  ipcMain.handle(IpcChannels.FOUNDATION_GET_DIAGNOSTICS, (event, payload: unknown) =>
    handleIpc(
      IpcChannels.FOUNDATION_GET_DIAGNOSTICS,
      event,
      async (): Promise<FoundationDiagnostics> => {
        let client: ClientSecurityReport | undefined;
        if (payload !== undefined) {
          const parsed = ClientSecurityReportSchema.safeParse(payload);
          if (!parsed.success) {
            throw new ValidationError('Invalid client security report');
          }
          client = parsed.data;
        }

        const { config, credentials, session, audio } = getAppServices();
        const storage = credentials.getStorageState();
        const configured = storage === 'available' ? await credentials.hasCredential('primary-provider') : false;
        const sttStatus = await audio.getSttConfigStatus();
        const sessionSnapshot = session.getManager().getStatus();
        const logDir = getLogDirectory();

        const checks: FoundationCheckItem[] = buildFoundationChecks({
          client,
          configLoaded: Boolean(config.getPublic()),
          sessionState: sessionSnapshot.state,
          loggerReady: Boolean(logDir),
          credentialStorage: storage,
          credentialConfigured: configured,
          sttConfigured: sttStatus.configured,
          sttProvider: sttStatus.provider,
        });

        return {
          checks,
          runtime: {
            name: APP_DISPLAY_NAME,
            version: app.getVersion(),
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
            platform: process.platform,
            arch: process.arch,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            isPackaged: app.isPackaged,
          },
          publicConfig: config.getPublic(),
          session: sessionSnapshot,
          ipc: 'connected',
          credentialStorage: storage,
        };
      },
    ),
  );
}
