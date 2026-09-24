export type STTStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'reconnecting'
  | 'error';

export type Unsubscribe = () => void;

export interface STTMetrics {
  connectionLatencyMs: number | null;
  lastChunkSendLatencyMs: number | null;
  lastPartialLatencyMs: number | null;
  lastFinalLatencyMs: number | null;
  chunksSent: number;
  partialsReceived: number;
  finalsReceived: number;
}

export interface STTProviderStatus {
  status: STTStatus;
  errorMessage: string | null;
  provider: string;
  configured: boolean;
  recoverable: boolean;
  metrics: STTMetrics;
}

export interface SttConfigStatus {
  provider: string;
  model: string;
  language: string;
  configured: boolean;
  sampleRate: number;
  channels: number;
  interimResults: boolean;
}

export const EMPTY_STT_METRICS: STTMetrics = {
  connectionLatencyMs: null,
  lastChunkSendLatencyMs: null,
  lastPartialLatencyMs: null,
  lastFinalLatencyMs: null,
  chunksSent: 0,
  partialsReceived: 0,
  finalsReceived: 0,
};
