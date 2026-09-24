export type AudioCaptureState =
  | 'idle'
  | 'requesting_permission'
  | 'ready'
  | 'starting'
  | 'active'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'error';

export type MicrophonePermissionStatus =
  | 'required'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'unknown';

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  groupId: string;
  isDefault: boolean;
}

export interface AudioStreamConfig {
  deviceId?: string;
  sampleRate: number;
  channels: number;
}

export interface AudioChunk {
  sequence: number;
  timestamp: number;
  /** PCM Int16 little-endian bytes (not logged / not persisted by default). */
  data: ArrayBuffer;
  sampleRate: number;
  channels: number;
}

/** IPC-safe chunk representation (base64). Never written to logs. */
export interface AudioChunkDto {
  sequence: number;
  timestamp: number;
  dataBase64: string;
  sampleRate: number;
  channels: number;
  byteLength: number;
  /** Phase 2M — which capture path produced this chunk. Defaults to microphone. */
  source?: 'microphone' | 'meeting_audio';
}

export interface AudioCaptureStatus {
  state: AudioCaptureState;
  permission: MicrophonePermissionStatus;
  selectedDeviceId: string | null;
  errorMessage: string | null;
  active: boolean;
}

export const DEFAULT_AUDIO_STREAM_CONFIG: AudioStreamConfig = {
  sampleRate: 16000,
  channels: 1,
};
