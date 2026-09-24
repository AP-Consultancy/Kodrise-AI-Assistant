import type { DetectedQuestion } from '../questions/types';
import type { ContextSnapshot } from '../context/types';
import type { SafeErrorPayload } from '../errors';

export type ResponseMode = 'short' | 'normal' | 'detailed';

export type AIProviderId = 'openai' | 'mock';

export type AIResponseStatus =
  | 'idle'
  | 'preparing'
  | 'generating'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface AIPromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AIRequestMetadata {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  responseMode: ResponseMode;
  provider: AIProviderId;
  contextId: string;
  questionId: string;
}

export interface AIRequest {
  requestId: string;
  sessionId: string | null;
  correlationId: string | null;
  question: DetectedQuestion;
  context: ContextSnapshot;
  responseMode: ResponseMode;
  messages: AIPromptMessage[];
  metadata: AIRequestMetadata;
}

export interface AIChunk {
  requestId: string;
  sequence: number;
  text: string;
  isFinal: boolean;
}

export interface AIResponseMetadata {
  model: string | null;
  provider: AIProviderId | null;
  responseMode: ResponseMode | null;
  usage: AIUsage | null;
  latencyMs: number | null;
  timeToFirstTokenMs: number | null;
  truncated: boolean;
}

export interface AIResponseState {
  id: string;
  requestId: string;
  questionId: string;
  sessionId: string | null;
  correlationId: string | null;
  status: AIResponseStatus;
  text: string;
  startedAt: number | null;
  firstTokenAt: number | null;
  completedAt: number | null;
  error: SafeErrorPayload | null;
  metadata: AIResponseMetadata;
}

export type AIEventType =
  | 'ai.request.started'
  | 'ai.response.started'
  | 'ai.response.chunk'
  | 'ai.response.completed'
  | 'ai.response.cancelled'
  | 'ai.response.error';

export interface AIEvent {
  type: AIEventType;
  requestId: string;
  responseId: string;
  questionId: string;
  sessionId: string | null;
  correlationId: string | null;
  timestamp: number;
  sequence?: number;
  textDelta?: string;
  status?: AIResponseStatus;
  error?: SafeErrorPayload;
  metadata?: Partial<AIResponseMetadata>;
}

export interface AIProviderStatus {
  provider: AIProviderId;
  connected: boolean;
  model: string;
  activeRequestId: string | null;
  lastErrorCode: string | null;
}

export interface AIOrchestratorStatus {
  enabled: boolean;
  provider: AIProviderId;
  model: string;
  autoGenerate: boolean;
  configured: boolean;
  activeRequestId: string | null;
  currentResponseId: string | null;
  responseStatus: AIResponseStatus;
  lastLatencyMs: number | null;
  lastErrorCode: string | null;
}

/** Non-secret AI settings. API keys live in CredentialVault only. */
export interface AIPublicConfig {
  provider: AIProviderId;
  model: string;
  responseMode: ResponseMode;
  temperature: number;
  maxOutputTokens: number;
  /** When true, generate after a classified question + context snapshot. Default false. */
  autoGenerate: boolean;
  minClassificationConfidence: number;
  maxResponseHistory: number;
}

export const DEFAULT_AI_PUBLIC_CONFIG: AIPublicConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  responseMode: 'normal',
  temperature: 0.4,
  maxOutputTokens: 800,
  autoGenerate: false,
  minClassificationConfidence: 0.7,
  maxResponseHistory: 20,
};

/** CredentialVault key for OpenAI API token. Never exposed to renderer. */
export const AI_OPENAI_CREDENTIAL_KEY = 'ai.openai.apiKey';

export interface AIConfigStatus {
  provider: AIProviderId;
  model: string;
  responseMode: ResponseMode;
  autoGenerate: boolean;
  configured: boolean;
  temperature: number;
  maxOutputTokens: number;
}
