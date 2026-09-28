import type {
  AIChunk,
  AIProviderCapabilities,
  AIProviderStatus,
  AIRequest,
} from '../../shared/ai/types';

/**
 * Provider-independent LLM port.
 * Adapters may use vendor SDKs; core must not import those SDKs.
 */
export interface AIProvider {
  connect(): Promise<void>;
  generate(request: AIRequest): AsyncIterable<AIChunk>;
  cancel(requestId: string): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): AIProviderStatus;
  /** Optional capability metadata — providers without it are treated as text+streaming. */
  getCapabilities?(): AIProviderCapabilities;
}
