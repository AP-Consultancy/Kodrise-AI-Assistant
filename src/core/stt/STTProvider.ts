import type { AudioChunk } from '../../shared/audio/types';
import type { TranscriptEvent } from '../../shared/transcription/types';
import type { STTProviderStatus, Unsubscribe } from '../../shared/stt/types';

export interface STTProvider {
  connect(): Promise<void>;
  sendAudio(chunk: AudioChunk): Promise<void>;
  onPartialTranscript(callback: (event: TranscriptEvent) => void): Unsubscribe;
  onFinalTranscript(callback: (event: TranscriptEvent) => void): Unsubscribe;
  onStatus(callback: (status: STTProviderStatus) => void): Unsubscribe;
  disconnect(): Promise<void>;
  getStatus(): STTProviderStatus;
}
