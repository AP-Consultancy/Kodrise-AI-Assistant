import type {
  AudioInputCapability,
  AudioInputConfig,
  AudioInputDevice,
  AudioInputDiagnostics,
  AudioInputMode,
  AudioInputState,
  AudioInputStatus,
} from '../../shared/audio-input/types';
import {
  DEFAULT_AUDIO_INPUT_CONFIG,
  DEFAULT_AUDIO_INPUT_MODE,
  WINDOWS_LOOPBACK_DEVICE_ID,
} from '../../shared/audio-input/types';
import {
  AudioInputUnavailableError,
  AudioSourceUnsupportedError,
  ValidationError,
} from '../../shared/errors';

export interface AudioInputProvider {
  enumerateDevices(): Promise<AudioInputDevice[]>;
  start(config: AudioInputConfig): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getState(): AudioInputState;
}

export type AudioInputLogFn = (event: string, meta: Record<string, unknown>) => void;

function mapPlatform(platform: NodeJS.Platform): AudioInputCapability['platform'] {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'unknown';
}

/**
 * Detects whether Meeting/System Audio can be requested on this OS.
 * Windows: documented Electron display-media loopback path.
 * Other platforms: not claimed as supported in Phase 2M.
 */
export function detectMeetingAudioCapability(
  mode: AudioInputMode,
  platform: NodeJS.Platform = process.platform,
): AudioInputCapability {
  const mapped = mapPlatform(platform);
  const microphoneAvailable = true;

  if (mode === 'microphone') {
    return {
      supported: true,
      platform: mapped,
      mode,
      meetingAudioAvailable: mapped === 'windows',
      microphoneAvailable,
    };
  }

  if (mapped !== 'windows') {
    return {
      supported: false,
      platform: mapped,
      mode,
      reason: 'Meeting/System Audio is unavailable on this device.',
      meetingAudioAvailable: false,
      microphoneAvailable,
    };
  }

  return {
    supported: true,
    platform: mapped,
    mode,
    meetingAudioAvailable: true,
    microphoneAvailable,
  };
}

export function listWindowsMeetingDevices(): AudioInputDevice[] {
  return [
    {
      id: WINDOWS_LOOPBACK_DEVICE_ID,
      label: 'System / Meeting Audio (loopback)',
      kind: 'loopback',
    },
  ];
}

/**
 * Coordinates user-selected audio input mode (mic / meeting / both).
 * Does not own PCM capture — renderer providers push chunks into AudioHost.
 */
export class AudioInputCoordinator {
  private mode: AudioInputMode = DEFAULT_AUDIO_INPUT_MODE;
  private state: AudioInputState = 'idle';
  private microphoneDeviceId: string | null = null;
  private meetingAudioDeviceId: string | null = null;
  private microphoneActive = false;
  private meetingAudioActive = false;
  private consentAcknowledged = false;
  private errorMessage: string | null = null;
  private readonly onLog: AudioInputLogFn;
  private readonly getPlatform: () => NodeJS.Platform;

  constructor(options?: {
    initialMode?: AudioInputMode;
    onLog?: AudioInputLogFn;
    getPlatform?: () => NodeJS.Platform;
  }) {
    this.mode = options?.initialMode ?? DEFAULT_AUDIO_INPUT_MODE;
    this.onLog = options?.onLog ?? (() => undefined);
    this.getPlatform = options?.getPlatform ?? (() => process.platform);
  }

  getMode(): AudioInputMode {
    return this.mode;
  }

  setMode(mode: AudioInputMode): AudioInputCapability {
    if (
      mode !== 'microphone' &&
      mode !== 'meeting_audio' &&
      mode !== 'microphone_and_meeting'
    ) {
      throw new ValidationError('Invalid audio input mode', { mode });
    }
    const capability = detectMeetingAudioCapability(mode, this.getPlatform());
    if (mode !== 'microphone' && !capability.supported) {
      this.onLog('audio.input.capability', {
        mode,
        supported: false,
        reason: capability.reason ?? null,
      });
      throw new AudioSourceUnsupportedError(
        capability.reason ?? 'Meeting/System Audio is unavailable on this device.',
        { mode, platform: capability.platform },
      );
    }
    this.mode = mode;
    this.onLog('audio.input.mode.selected', { mode });
    this.onLog('audio.input.capability', {
      mode,
      supported: capability.supported,
      platform: capability.platform,
    });
    return capability;
  }

  setMicrophoneDeviceId(deviceId: string | null): void {
    this.microphoneDeviceId = deviceId;
    this.onLog('audio.input.device.selected', { role: 'microphone', deviceId });
  }

  setMeetingAudioDeviceId(deviceId: string | null): void {
    this.meetingAudioDeviceId = deviceId;
    this.onLog('audio.input.device.selected', { role: 'meeting_audio', deviceId });
  }

  acknowledgeConsent(): void {
    this.consentAcknowledged = true;
  }

  getCapability(mode: AudioInputMode = this.mode): AudioInputCapability {
    return detectMeetingAudioCapability(mode, this.getPlatform());
  }

  async enumerateDevices(): Promise<AudioInputDevice[]> {
    const devices: AudioInputDevice[] = [];
    if (this.getCapability('meeting_audio').meetingAudioAvailable) {
      devices.push(...listWindowsMeetingDevices());
    }
    return devices;
  }

  getConfig(): AudioInputConfig {
    return {
      mode: this.mode,
      microphoneDeviceId: this.microphoneDeviceId,
      meetingAudioDeviceId: this.meetingAudioDeviceId,
      sampleRate: DEFAULT_AUDIO_INPUT_CONFIG.sampleRate,
      channels: DEFAULT_AUDIO_INPUT_CONFIG.channels,
    };
  }

  getStatus(): AudioInputStatus {
    return {
      mode: this.mode,
      state: this.state,
      microphoneDeviceId: this.microphoneDeviceId,
      meetingAudioDeviceId: this.meetingAudioDeviceId,
      microphoneActive: this.microphoneActive,
      meetingAudioActive: this.meetingAudioActive,
      capability: this.getCapability(),
      errorMessage: this.errorMessage,
      consentAcknowledged: this.consentAcknowledged,
    };
  }

  getDiagnostics(): AudioInputDiagnostics {
    const capability = this.getCapability();
    const details: string[] = [];
    let capabilityStatus: AudioInputDiagnostics['capability'] = 'NOT_TESTED';
    if (this.mode === 'microphone') {
      capabilityStatus = 'PASS';
    } else if (!capability.supported) {
      capabilityStatus = 'UNAVAILABLE';
      details.push(capability.reason ?? 'Meeting audio unsupported');
    } else if (this.state === 'active') {
      capabilityStatus = 'PASS';
    } else if (this.state === 'error') {
      capabilityStatus = 'FAIL';
    } else {
      capabilityStatus = 'NOT_CONFIGURED';
    }

    const needsMeeting =
      this.mode === 'meeting_audio' || this.mode === 'microphone_and_meeting';
    const needsMic =
      this.mode === 'microphone' || this.mode === 'microphone_and_meeting';

    let deviceStatus: AudioInputDiagnostics['device'] = 'NOT_TESTED';
    if (needsMeeting && !this.meetingAudioDeviceId) {
      deviceStatus = 'NOT_CONFIGURED';
    } else if (needsMic && this.microphoneDeviceId === undefined) {
      deviceStatus = 'NOT_CONFIGURED';
    } else if (this.state === 'active') {
      deviceStatus = 'PASS';
    } else if (this.state === 'error') {
      deviceStatus = 'FAIL';
    } else {
      deviceStatus = 'NOT_CONFIGURED';
    }

    let stateStatus: AudioInputDiagnostics['state'] = 'NOT_TESTED';
    if (this.state === 'active') stateStatus = 'PASS';
    else if (this.state === 'error') stateStatus = 'FAIL';
    else if (this.state === 'idle') stateStatus = 'NOT_CONFIGURED';
    else stateStatus = 'NOT_TESTED';

    let modeStatus: AudioInputDiagnostics['mode'] = 'PASS';
    if (this.mode !== 'microphone' && !capability.supported) {
      modeStatus = 'UNAVAILABLE';
    }

    return {
      mode: modeStatus,
      device: deviceStatus,
      capability: capabilityStatus,
      state: stateStatus,
      details,
    };
  }

  /**
   * Validate and mark sources starting. Does not open OS devices itself.
   */
  beginStart(): void {
    const capability = this.getCapability();
    if (this.mode !== 'microphone' && !capability.supported) {
      this.state = 'error';
      this.errorMessage = capability.reason ?? 'Meeting/System Audio is unavailable on this device.';
      this.onLog('audio.input.error', { code: 'UNSUPPORTED', mode: this.mode });
      throw new AudioInputUnavailableError(this.errorMessage, { mode: this.mode });
    }
    if (
      (this.mode === 'meeting_audio' || this.mode === 'microphone_and_meeting') &&
      !this.consentAcknowledged
    ) {
      this.state = 'error';
      this.errorMessage =
        'Confirm that Meeting/System Audio will be processed by the interview assistant.';
      throw new ValidationError(this.errorMessage);
    }
    this.state = 'starting';
    this.errorMessage = null;
    this.microphoneActive = false;
    this.meetingAudioActive = false;
  }

  markSourceActive(source: 'microphone' | 'meeting_audio'): void {
    if (source === 'microphone') this.microphoneActive = true;
    if (source === 'meeting_audio') this.meetingAudioActive = true;
    const needsMic = this.mode === 'microphone' || this.mode === 'microphone_and_meeting';
    const needsMeeting =
      this.mode === 'meeting_audio' || this.mode === 'microphone_and_meeting';
    const micOk = !needsMic || this.microphoneActive;
    const meetingOk = !needsMeeting || this.meetingAudioActive;
    if (micOk && meetingOk) {
      this.state = 'active';
      this.onLog('audio.input.started', {
        mode: this.mode,
        microphoneActive: this.microphoneActive,
        meetingAudioActive: this.meetingAudioActive,
      });
    }
  }

  pause(): void {
    if (this.state === 'idle' || this.state === 'stopping') return;
    this.state = 'paused';
    this.onLog('audio.input.paused', { mode: this.mode });
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'active';
    this.onLog('audio.input.resumed', { mode: this.mode });
  }

  stop(): void {
    this.state = 'idle';
    this.microphoneActive = false;
    this.meetingAudioActive = false;
    this.errorMessage = null;
    this.onLog('audio.input.stopped', { mode: this.mode });
  }

  reset(): void {
    this.stop();
    this.consentAcknowledged = false;
  }

  reportError(message: string): void {
    this.state = 'error';
    this.errorMessage = message;
    this.onLog('audio.input.error', { message });
  }

  usesMicrophone(): boolean {
    return this.mode === 'microphone' || this.mode === 'microphone_and_meeting';
  }

  usesMeetingAudio(): boolean {
    return this.mode === 'meeting_audio' || this.mode === 'microphone_and_meeting';
  }
}

/** Deterministic provider for unit tests — no physical devices. */
export class MockAudioInputProvider implements AudioInputProvider {
  private state: AudioInputState = 'idle';
  private readonly devices: AudioInputDevice[];

  constructor(devices?: AudioInputDevice[]) {
    this.devices = devices ?? [
      { id: 'mock-mic', label: 'Mock Microphone', kind: 'microphone' },
      { id: 'mock-loopback', label: 'Mock Meeting Audio', kind: 'loopback' },
    ];
  }

  async enumerateDevices(): Promise<AudioInputDevice[]> {
    return this.devices.map((d) => ({ ...d }));
  }

  async start(_config: AudioInputConfig): Promise<void> {
    this.state = 'active';
  }

  async stop(): Promise<void> {
    this.state = 'idle';
  }

  async pause(): Promise<void> {
    this.state = 'paused';
  }

  async resume(): Promise<void> {
    this.state = 'active';
  }

  getState(): AudioInputState {
    return this.state;
  }
}
