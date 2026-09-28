import type { AIPublicConfig } from '../../shared/ai/types';
import type { AIProvider } from '../../core/ai/AIProvider';
import { MockAIProvider } from './providers/MockAIProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { logger } from '../services/logging';

export interface CreateAiProviderOptions {
  config: AIPublicConfig;
  /** Resolves the vault secret for the selected provider (OpenAI or Gemini). */
  getApiKey: () => Promise<string | null>;
}

export function createAiProvider(options: CreateAiProviderOptions): AIProvider {
  const { config, getApiKey } = options;
  logger.info('ai.provider.selected', {
    provider: config.provider,
    model: config.model,
  });
  logger.info('ai.provider.initializing', {
    provider: config.provider,
    model: config.model,
  });

  if (config.provider === 'mock') {
    return new MockAIProvider({ model: config.model });
  }

  if (config.provider === 'gemini') {
    logger.info('ai.gemini.initialized', { model: config.model });
    return new GeminiProvider({
      model: config.model,
      getApiKey,
    });
  }

  return new OpenAIProvider({
    model: config.model,
    getApiKey,
  });
}
