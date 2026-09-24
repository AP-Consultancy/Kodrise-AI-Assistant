import type { SttPublicConfig } from '../../../shared/config/types';
import { STTConfigurationError } from '../../../shared/errors';
import type { STTProvider } from '../../../core/stt/STTProvider';
import { MockSTTProvider } from '../../../core/stt/MockSTTProvider';
import { DeepgramSTTProvider } from './DeepgramSTTProvider';
import { logger } from '../../services/logging';

export interface CreateSttProviderDeps {
  config: SttPublicConfig;
  getApiKey: () => Promise<string | null>;
}

export function createSttProvider(deps: CreateSttProviderDeps): STTProvider {
  logger.info('stt.provider.initializing', {
    provider: deps.config.provider,
    model: deps.config.model,
    language: deps.config.language,
  });

  if (deps.config.provider === 'mock') {
    return new MockSTTProvider();
  }

  if (deps.config.provider === 'deepgram') {
    return new DeepgramSTTProvider({
      config: deps.config,
      getApiKey: deps.getApiKey,
    });
  }

  throw new STTConfigurationError(`Unknown STT provider: ${String(deps.config.provider)}`);
}
