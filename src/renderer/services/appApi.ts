import type {
  ClientSecurityReport,
  CompanyAiApi,
  FoundationDiagnostics,
  IpcResult,
  SessionSnapshot,
  SystemStatus,
} from '@shared/ipc/types';
import type { PublicConfig } from '../../shared/config/types';

function getApi(): CompanyAiApi {
  if (typeof window === 'undefined' || typeof window.companyAI === 'undefined') {
    throw new Error('Preload API window.companyAI is unavailable');
  }
  return window.companyAI;
}

export function buildClientSecurityReport(): ClientSecurityReport {
  return {
    preloadAvailable: typeof window.companyAI !== 'undefined',
    companyAiApiPresent: typeof window.companyAI !== 'undefined',
    nodeRequirePresent: typeof (window as unknown as { require?: unknown }).require !== 'undefined',
  };
}

export async function getSystemStatus(): Promise<IpcResult<SystemStatus>> {
  return getApi().system.getStatus();
}

export async function getDiagnostics(): Promise<IpcResult<FoundationDiagnostics>> {
  return getApi().foundation.getDiagnostics(buildClientSecurityReport());
}

export async function startSession(): Promise<IpcResult<SessionSnapshot>> {
  return getApi().session.start();
}

export async function stopSession(): Promise<IpcResult<SessionSnapshot>> {
  return getApi().session.stop();
}

export async function pauseSession(): Promise<IpcResult<SessionSnapshot>> {
  return getApi().session.pause();
}

export async function resumeSession(): Promise<IpcResult<SessionSnapshot>> {
  return getApi().session.resume();
}

export async function getPublicConfig(): Promise<IpcResult<PublicConfig>> {
  return getApi().config.getPublic();
}

export async function updatePublicConfig(
  patch: Partial<PublicConfig>,
): Promise<IpcResult<PublicConfig>> {
  return getApi().config.update(patch);
}
