import type { AudioChunkDto, AudioDeviceInfo, MicrophonePermissionStatus } from '../../shared/audio/types';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]!));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

/** Linear resample when the browser ignores AudioContext({ sampleRate }). */
function resampleFloat32(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) {
    return input;
  }
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outLength);
  for (let index = 0; index < outLength; index += 1) {
    const srcIndex = index * ratio;
    const left = Math.floor(srcIndex);
    const right = Math.min(left + 1, input.length - 1);
    const frac = srcIndex - left;
    output[index] = input[left]! * (1 - frac) + input[right]! * frac;
  }
  return output;
}

export async function enumerateInputDevices(): Promise<AudioDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === 'audioinput');
  return inputs.map((device, index) => ({
    deviceId: device.deviceId || `device-${index}`,
    label: device.label || `Microphone ${index + 1}`,
    groupId: device.groupId || '',
    isDefault: index === 0,
  }));
}

export async function queryMicrophonePermission(): Promise<MicrophonePermissionStatus> {
  try {
    if (!navigator.permissions?.query) {
      return 'unknown';
    }
    const result = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    });
    if (result.state === 'granted') {
      return 'granted';
    }
    if (result.state === 'denied') {
      return 'denied';
    }
    return 'required';
  } catch {
    return 'unknown';
  }
}

export interface BrowserCaptureHandle {
  stop: () => void;
  pause: () => void;
  resume: () => void;
}

export async function startBrowserCapture(options: {
  deviceId?: string | null;
  sampleRate: number;
  onChunk: (chunk: AudioChunkDto) => void;
  onError: (message: string) => void;
}): Promise<BrowserCaptureHandle> {
  const constraints: MediaStreamConstraints = {
    audio: options.deviceId
      ? {
          deviceId: { exact: options.deviceId },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      : {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
    video: false,
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const audioContext = new AudioContext({ sampleRate: options.sampleRate });
  const actualSampleRate = audioContext.sampleRate;
  const targetSampleRate = options.sampleRate;
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  let sequence = 0;
  let paused = false;

  processor.onaudioprocess = (event) => {
    if (paused) {
      return;
    }
    const input = event.inputBuffer.getChannelData(0);
    const resampled = resampleFloat32(input, actualSampleRate, targetSampleRate);
    const pcm = floatTo16BitPCM(resampled);
    sequence += 1;
    options.onChunk({
      sequence,
      timestamp: Date.now(),
      dataBase64: arrayBufferToBase64(pcm),
      sampleRate: targetSampleRate,
      channels: 1,
      byteLength: pcm.byteLength,
    });
  };

  // Keep the processor graph alive without playing mic audio through speakers.
  const mute = audioContext.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);

  return {
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
    stop: () => {
      paused = true;
      try {
        processor.disconnect();
        source.disconnect();
      } catch {
        // ignore
      }
      for (const track of stream.getTracks()) {
        track.stop();
      }
      void audioContext.close();
    },
  };
}
