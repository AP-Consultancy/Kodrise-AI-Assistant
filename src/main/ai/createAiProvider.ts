import type { AIPublicConfig } from '../../shared/ai/types';
import type { AIProvider } from '../../core/ai/AIProvider';
import { MockAIProvider } from './providers/MockAIProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { logger } from '../services/logging';

export interface CreateAiProviderOptions {
  config: AIPublicConfig;
  getApiKey: () => Promise<string | null>;
}

export function createAiProvider(options: CreateAiProviderOptions): AIProvider {
  const { config, getApiKey } = options;
  logger.info('ai.provider.initializing', {
    provider: config.provider,
    model: config.model,
  });

  if (config.provider === 'mock') {
    return new MockAIProvider({ model: config.model });
  }

  return new OpenAIProvider({
    model: config.model,
    getApiKey,
  });
}
