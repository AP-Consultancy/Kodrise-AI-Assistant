import { describe, expect, it } from 'vitest';
import { AudioCaptureController } from '../../src/core/audio/AudioCaptureController';
import { AudioCaptureError } from '../../src/shared/errors';

describe('AudioCaptureController state machine', () => {
  it('allows granted permission → ready → start → active → pause → resume → stop', () => {
    const capture = new AudioCaptureController();
    capture.setPermission('granted');
    expect(capture.getStatus().state).toBe('ready');
    expect(capture.getStatus().permission).toBe('granted');

    capture.beginStart({ sampleRate: 16000, channels: 1 });
    expect(capture.getStatus().state).toBe('starting');

    capture.markActive();
    expect(capture.getStatus()).toMatchObject({ state: 'active', active: true });

    capture.pause();
    expect(capture.getStatus().state).toBe('paused');

    capture.resume();
    expect(capture.getStatus().state).toBe('active');

    capture.beginStop();
    capture.markStopped();
    expect(capture.getStatus()).toMatchObject({ state: 'stopped', active: false });
  });

  it('rejects invalid transitions', () => {
    const capture = new AudioCaptureController();
    expect(() => capture.pause()).toThrow(AudioCaptureError);
    expect(() => capture.resume()).toThrow(AudioCaptureError);
  });

  it('validates device selection is stored', () => {
    const capture = new AudioCaptureController();
    capture.selectDevice('mic-1');
    expect(capture.getStatus().selectedDeviceId).toBe('mic-1');
    capture.selectDevice(null);
    expect(capture.getStatus().selectedDeviceId).toBeNull();
  });

  it('handles permission request lifecycle', () => {
    const capture = new AudioCaptureController();
    capture.beginPermissionRequest();
    expect(capture.getStatus().state).toBe('requesting_permission');
    capture.setPermission('denied');
    expect(capture.getStatus().state).toBe('idle');
    expect(capture.getStatus().permission).toBe('denied');
  });

  it('forceStop terminates active capture', () => {
    const capture = new AudioCaptureController();
    capture.setPermission('granted');
    capture.beginStart();
    capture.markActive();
    capture.forceStop();
    expect(capture.getStatus().state).toBe('stopped');
    expect(capture.getStatus().active).toBe(false);
  });
});
