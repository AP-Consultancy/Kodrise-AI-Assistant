import { AudioCaptureError } from '../../shared/errors';
import type {
  AudioCaptureState,
  AudioCaptureStatus,
  AudioStreamConfig,
  MicrophonePermissionStatus,
} from '../../shared/audio/types';
import { DEFAULT_AUDIO_STREAM_CONFIG } from '../../shared/audio/types';

const ALLOWED_TRANSITIONS: Record<AudioCaptureState, readonly AudioCaptureState[]> = {
  idle: ['requesting_permission', 'ready', 'starting', 'error'],
  requesting_permission: ['ready', 'idle', 'error'],
  ready: ['starting', 'idle', 'error'],
  starting: ['active', 'error', 'stopping'],
  active: ['paused', 'stopping', 'error'],
  paused: ['active', 'stopping', 'error'],
  stopping: ['stopped', 'idle', 'error'],
  stopped: ['idle', 'ready', 'starting'],
  error: ['idle', 'ready'],
};

export type AudioCaptureListener = (status: AudioCaptureStatus) => void;

export class AudioCaptureController {
  private state: AudioCaptureState = 'idle';
  private permission: MicrophonePermissionStatus = 'unknown';
  private selectedDeviceId: string | null = null;
  private errorMessage: string | null = null;
  private config: AudioStreamConfig = { ...DEFAULT_AUDIO_STREAM_CONFIG };
  private readonly listeners = new Set<AudioCaptureListener>();

  subscribe(listener: AudioCaptureListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): AudioCaptureStatus {
    return {
      state: this.state,
      permission: this.permission,
      selectedDeviceId: this.selectedDeviceId,
      errorMessage: this.errorMessage,
      active: this.state === 'active',
    };
  }

  getConfig(): AudioStreamConfig {
    return { ...this.config };
  }

  setPermission(permission: MicrophonePermissionStatus): void {
    this.permission = permission;
    if (permission === 'granted' && (this.state === 'idle' || this.state === 'requesting_permission')) {
      this.transition('ready');
    }
    if (permission === 'denied' && this.state === 'requesting_permission') {
      this.transition('idle');
    }
    this.emit();
  }

  beginPermissionRequest(): void {
    this.transition('requesting_permission');
    this.emit();
  }

  selectDevice(deviceId: string | null): void {
    this.selectedDeviceId = deviceId;
    this.emit();
  }

  beginStart(config?: Partial<AudioStreamConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      sampleRate: config?.sampleRate ?? this.config.sampleRate,
      channels: config?.channels ?? this.config.channels,
    };

    if (this.state === 'idle' && this.permission === 'granted') {
      this.transition('ready');
    } else if (this.state === 'stopped') {
      this.transition(this.permission === 'granted' ? 'ready' : 'idle');
    }

    this.transition('starting');
    this.errorMessage = null;
    this.emit();
  }

  markActive(): void {
    this.transition('active');
    this.errorMessage = null;
    this.emit();
  }

  pause(): void {
    this.transition('paused');
    this.emit();
  }

  resume(): void {
    if (this.state !== 'paused') {
      throw new AudioCaptureError(`Cannot resume audio from state "${this.state}"`);
    }
    this.transition('active');
    this.emit();
  }

  beginStop(): void {
    if (this.state === 'idle' || this.state === 'stopped') {
      return;
    }
    if (this.state !== 'stopping') {
      this.transition('stopping');
    }
    this.emit();
  }

  markStopped(): void {
    if (this.state === 'idle' || this.state === 'stopped') {
      this.state = 'stopped';
      this.emit();
      return;
    }
    if (this.state !== 'stopping') {
      this.transition('stopping');
    }
    this.transition('stopped');
    this.emit();
  }

  forceStop(): void {
    if (this.state === 'idle' || this.state === 'stopped') {
      this.state = 'stopped';
      this.emit();
      return;
    }
    try {
      this.beginStop();
      this.markStopped();
    } catch {
      this.state = 'stopped';
      this.emit();
    }
  }

  markError(message: string): void {
    this.errorMessage = message;
    if (this.state !== 'error') {
      this.transition('error');
    }
    this.emit();
  }

  private transition(next: AudioCaptureState): void {
    const current = this.state;
    if (current === next) {
      return;
    }
    if (!ALLOWED_TRANSITIONS[current].includes(next)) {
      throw new AudioCaptureError(`Invalid audio transition: ${current} → ${next}`, {
        from: current,
        to: next,
      });
    }
    this.state = next;
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}
