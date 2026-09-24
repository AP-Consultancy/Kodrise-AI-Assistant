import { ConfigurationService } from '../../core/configuration/ConfigurationService';
import type { CredentialVault } from '../../core/configuration/CredentialVault';
import type { SessionHost } from './session/SessionHost';
import type { AudioHost } from './audio/AudioHost';
import type { CapturePolicyHost } from '../capture/CapturePolicyHost';
import type { VisualContextHost } from '../visual/VisualContextHost';
import type { InterviewHost } from '../interview/InterviewHost';
import type { SimulationHost } from '../simulation/SimulationHost';
import type { Logger } from './logging';

export interface AppServices {
  config: ConfigurationService;
  credentials: CredentialVault;
  session: SessionHost;
  audio: AudioHost;
  capturePolicy: CapturePolicyHost;
  visual: VisualContextHost;
  interview: InterviewHost;
  simulation: SimulationHost;
  logger: Logger;
}

let services: AppServices | null = null;

export function setAppServices(next: AppServices): void {
  services = next;
}

export function getAppServices(): AppServices {
  if (!services) {
    throw new Error('App services have not been initialized');
  }
  return services;
}
