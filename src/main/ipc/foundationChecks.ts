import type {
  CheckStatus,
  ClientSecurityReport,
  CredentialStorageState,
  FoundationCheckItem,
} from '../../shared/ipc/types';
import type { SessionState } from '../../shared/session/types';

export interface FoundationCheckInput {
  client?: ClientSecurityReport;
  configLoaded: boolean;
  sessionState: SessionState;
  loggerReady: boolean;
  credentialStorage: CredentialStorageState;
  credentialConfigured: boolean;
  sttConfigured?: boolean;
  sttProvider?: string;
}

/**
 * Builds diagnostics without claiming unverified security properties as PASS.
 * BrowserWindow webPreferences are compile-time configured; runtime client
 * signals are required for renderer-side isolation checks.
 */
export function buildFoundationChecks(input: FoundationCheckInput): FoundationCheckItem[] {
  const client = input.client;

  const preloadStatus: CheckStatus = !client
    ? 'not_tested'
    : client.preloadAvailable && client.companyAiApiPresent
      ? 'pass'
      : 'fail';

  const nodeStatus: CheckStatus = !client
    ? 'not_tested'
    : client.nodeRequirePresent
      ? 'fail'
      : 'pass';

  const contextStatus: CheckStatus = !client
    ? 'not_tested'
    : client.preloadAvailable && !client.nodeRequirePresent
      ? 'pass'
      : client.nodeRequirePresent
        ? 'fail'
        : 'not_tested';

  const credentialStatus: CheckStatus =
    input.credentialStorage === 'unavailable'
      ? 'unavailable'
      : input.credentialConfigured
        ? 'ready'
        : 'not_configured';

  return [
    {
      id: 'renderer',
      label: 'Renderer',
      status: client ? 'pass' : 'not_tested',
      detail: client
        ? 'Renderer submitted a client security report over IPC.'
        : 'Waiting for renderer client security report.',
    },
    {
      id: 'preload',
      label: 'Preload',
      status: preloadStatus,
      detail:
        preloadStatus === 'pass'
          ? 'window.companyAI observed by renderer.'
          : preloadStatus === 'fail'
            ? 'Preload API missing in renderer.'
            : 'Not tested from renderer yet.',
    },
    {
      id: 'contextIsolation',
      label: 'Context Isolation',
      status: contextStatus,
      detail:
        contextStatus === 'pass'
          ? 'Preload present and window.require absent (supports isolation).'
          : contextStatus === 'fail'
            ? 'Renderer observed window.require — isolation may be broken.'
            : 'Runtime isolation signals not yet reported by renderer.',
    },
    {
      id: 'nodeIntegration',
      label: 'Node Integration',
      status: nodeStatus,
      detail:
        nodeStatus === 'pass'
          ? 'window.require is absent in renderer.'
          : nodeStatus === 'fail'
            ? 'window.require is present in renderer.'
            : 'Not tested from renderer yet.',
    },
    {
      id: 'ipc',
      label: 'IPC',
      status: 'pass',
      detail: 'This diagnostics invoke succeeded through contextBridge → ipcMain.',
    },
    {
      id: 'configuration',
      label: 'Configuration',
      status: input.configLoaded ? 'pass' : 'fail',
      detail: input.configLoaded
        ? 'Public configuration service loaded validated settings.'
        : 'Public configuration failed to load.',
    },
    {
      id: 'session',
      label: 'Session Manager',
      status: 'pass',
      detail: `Session manager reachable. Current state: ${input.sessionState}`,
    },
    {
      id: 'logger',
      label: 'Logger',
      status: input.loggerReady ? 'pass' : 'not_tested',
      detail: input.loggerReady
        ? 'Structured file logging directory initialized.'
        : 'File logging directory not initialized.',
    },
    {
      id: 'credentials',
      label: 'Credential Vault',
      status: credentialStatus,
      detail:
        credentialStatus === 'ready'
          ? 'Secure storage available and a credential is configured.'
          : credentialStatus === 'not_configured'
            ? 'Secure storage available; no credential configured.'
            : credentialStatus === 'unavailable'
              ? 'Secure storage unavailable — credentials cannot be stored.'
              : 'Credential vault state unknown.',
    },
    {
      id: 'stt',
      label: 'Speech-to-Text',
      status: input.sttConfigured ? 'ready' : 'not_configured',
      detail: input.sttConfigured
        ? `STT provider "${input.sttProvider ?? 'configured'}" has credentials.`
        : `STT provider "${input.sttProvider ?? 'deepgram'}" credential not configured.`,
    },
  ];
}
