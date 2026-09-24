import type { AudioChunkDto } from '../../shared/audio/types';
import type { BrowserCaptureHandle } from './browserCapture';

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

/**
 * Windows meeting/system audio via documented getDisplayMedia + main-process loopback handler.
 * Requires explicit user Start Interview after selecting Meeting Audio in Settings.
 */
export async function startMeetingAudioCapture(options: {
  sampleRate: number;
  onChunk: (chunk: AudioChunkDto) => void;
  onError: (message: string) => void;
}): Promise<BrowserCaptureHandle> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Meeting/System Audio is unavailable on this device.');
  }

  let stream: MediaStream;
  try {
    // Video track is required by Chromium for display-media; audio comes from Electron loopback on Windows.
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
  } catch (error) {
    const message =
      error instanceof Error && /Permission|NotAllowed|denied/i.test(error.message)
        ? 'Permission denied for Meeting/System Audio.'
        : 'Could not start Meeting/System Audio. Check that a supported device is available.';
    throw new Error(message);
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    for (const track of stream.getTracks()) track.stop();
    throw new Error(
      'Meeting/System Audio did not provide an audio track. Capture may be unsupported for this source.',
    );
  }

  // Drop video frames — we only need loopback/system audio.
  for (const track of stream.getVideoTracks()) {
    track.stop();
  }

  const audioStream = new MediaStream(audioTracks);
  const audioContext = new AudioContext({ sampleRate: options.sampleRate });
  const actualSampleRate = audioContext.sampleRate;
  const targetSampleRate = options.sampleRate;
  const source = audioContext.createMediaStreamSource(audioStream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  let sequence = 0;
  let paused = false;

  processor.onaudioprocess = (event) => {
    if (paused) return;
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
      source: 'meeting_audio',
    });
  };

  const mute = audioContext.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);

  audioTracks[0]?.addEventListener('ended', () => {
    options.onError('Meeting/System Audio stream stopped unexpectedly.');
  });

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
      for (const track of audioStream.getTracks()) {
        track.stop();
      }
      void audioContext.close();
    },
  };
}
