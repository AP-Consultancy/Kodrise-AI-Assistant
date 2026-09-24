/**
 * Phase 2M — Meeting / system audio input (user-controlled).
 * Separate from InterviewExecutionMode (real | simulation).
 */

export type AudioInputMode =
  | 'microphone'
  | 'meeting_audio'
  | 'microphone_and_meeting';

export type TranscriptSource = 'microphone' | 'meeting_audio';

export type AudioInputDeviceKind = 'microphone' | 'system' | 'loopback' | 'unknown';

/** Safe device DTO for renderer — no secrets or native handles. */
export interface AudioInputDevice {
  id: string;
  label: string;
  kind: AudioInputDeviceKind;
}

export type AudioInputState =
  | 'idle'
  | 'starting'
  | 'active'
  | 'paused'
  | 'stopping'
  | 'error';

export interface AudioInputConfig {
  mode: AudioInputMode;
  microphoneDeviceId: string | null;
  meetingAudioDeviceId: string | null;
  sampleRate: number;
  channels: number;
}

export interface AudioInputCapability {
  supported: boolean;
  platform: 'windows' | 'macos' | 'linux' | 'unknown';
  mode: AudioInputMode;
  reason?: string;
  meetingAudioAvailable: boolean;
  microphoneAvailable: boolean;
}

export interface AudioInputStatus {
  mode: AudioInputMode;
  state: AudioInputState;
  microphoneDeviceId: string | null;
  meetingAudioDeviceId: string | null;
  microphoneActive: boolean;
  meetingAudioActive: boolean;
  capability: AudioInputCapability;
  errorMessage: string | null;
  consentAcknowledged: boolean;
}

export type AudioInputDiagnosticStatus =
  | 'PASS'
  | 'FAIL'
  | 'NOT_TESTED'
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE';

export interface AudioInputDiagnostics {
  mode: AudioInputDiagnosticStatus;
  device: AudioInputDiagnosticStatus;
  capability: AudioInputDiagnosticStatus;
  state: AudioInputDiagnosticStatus;
  details: string[];
}

export const DEFAULT_AUDIO_INPUT_MODE: AudioInputMode = 'microphone';

export const WINDOWS_LOOPBACK_DEVICE_ID = 'windows-system-loopback';

export const DEFAULT_AUDIO_INPUT_CONFIG: AudioInputConfig = {
  mode: DEFAULT_AUDIO_INPUT_MODE,
  microphoneDeviceId: null,
  meetingAudioDeviceId: null,
  sampleRate: 16000,
  channels: 1,
};
