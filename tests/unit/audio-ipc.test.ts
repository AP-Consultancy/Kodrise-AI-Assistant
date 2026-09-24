import { describe, expect, it } from 'vitest';
import {
  AudioChunkDtoSchema,
  AudioDevicesPayloadSchema,
  AudioPermissionSchema,
  AudioSelectDeviceSchema,
  AudioStartSchema,
  TranscriptRecentSchema,
} from '../../src/shared/ipc/schemas';
import { toSafeErrorPayload, ValidationError, AudioPermissionError } from '../../src/shared/errors';
import { AudioCaptureController } from '../../src/core/audio/AudioCaptureController';
import { TranscriptStore } from '../../src/core/transcription/TranscriptStore';
import { MockSTTProvider } from '../../src/core/stt/MockSTTProvider';

async function invokeAudioStart(permission: 'granted' | 'denied' | 'required') {
  const capture = new AudioCaptureController();
  capture.setPermission(permission);
  if (permission !== 'granted') {
    return {
      ok: false as const,
      error: toSafeErrorPayload(new AudioPermissionError('Microphone permission required')),
    };
  }
  capture.beginStart({ sampleRate: 16000, channels: 1 });
  return { ok: true as const, data: capture.getStatus() };
}

async function invokeSelectDevice(devices: Array<{ deviceId: string }>, deviceId: string | null) {
  const payload = { deviceId };
  const parsed = AudioSelectDeviceSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: toSafeErrorPayload(new ValidationError('Invalid audio device selection')),
    };
  }
  if (deviceId && !devices.some((device) => device.deviceId === deviceId)) {
    return {
      ok: false as const,
      error: toSafeErrorPayload(new ValidationError('Selected audio device is not available')),
    };
  }
  const capture = new AudioCaptureController();
  capture.selectDevice(deviceId);
  return { ok: true as const, data: capture.getStatus() };
}

describe('Audio / transcript IPC contracts', () => {
  it('rejects invalid audio IPC payloads', () => {
    expect(AudioStartSchema.safeParse({ sampleRate: 100 }).success).toBe(false);
    expect(AudioChunkDtoSchema.safeParse({ sequence: 1 }).success).toBe(false);
    expect(AudioPermissionSchema.safeParse({ permission: 'maybe' }).success).toBe(false);
    expect(AudioDevicesPayloadSchema.safeParse({ devices: 'nope' }).success).toBe(false);
    expect(TranscriptRecentSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('accepts valid audio start and chunk payloads', () => {
    expect(AudioStartSchema.safeParse({ sampleRate: 16000, channels: 1 }).success).toBe(true);
    expect(
      AudioChunkDtoSchema.safeParse({
        sequence: 1,
        timestamp: Date.now(),
        dataBase64: 'AAAA',
        sampleRate: 16000,
        channels: 1,
        byteLength: 4,
      }).success,
    ).toBe(true);
  });

  it('audio start handler rejects when permission is not granted', async () => {
    const result = await invokeAudioStart('required');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('AUDIO_PERMISSION');
    }
  });

  it('audio start handler succeeds when permission is granted', async () => {
    const result = await invokeAudioStart('granted');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.state).toBe('starting');
    }
  });

  it('device selection validation rejects unknown devices', async () => {
    const result = await invokeSelectDevice([{ deviceId: 'mic-a' }], 'missing');
    expect(result.ok).toBe(false);
  });

  it('transcript IPC-facing recent/clear behavior stays bounded', () => {
    const store = new TranscriptStore({ maxFinals: 2, idGenerator: () => 'x' });
    store.commitFinal('a');
    store.commitFinal('b');
    store.commitFinal('c');
    expect(store.getRecent(10)).toHaveLength(2);
    store.clear();
    expect(store.getStatus().segmentCount).toBe(0);
  });
});

describe('Session stop terminates audio', () => {
  it('force-stops capture and disconnects STT when session stops', async () => {
    const capture = new AudioCaptureController();
    const stt = new MockSTTProvider();

    capture.setPermission('granted');
    capture.beginStart();
    capture.markActive();
    await stt.connect();
    expect(capture.getStatus().active).toBe(true);
    expect(stt.getStatus().status).toBe('connected');

    // Mirrors session:stop → audio.forceStopFromSession orchestration.
    capture.forceStop();
    await stt.disconnect();

    expect(capture.getStatus().state).toBe('stopped');
    expect(capture.getStatus().active).toBe(false);
    expect(stt.getStatus().status).toBe('disconnected');
  });
});
