import { useCallback, useEffect, useRef, useState } from 'react';
import {
  enumerateInputDevices,
  queryMicrophonePermission,
  startBrowserCapture,
  type BrowserCaptureHandle,
} from '../audio/browserCapture';
import { startMeetingAudioCapture } from '../audio/meetingAudioCapture';
import type { AudioInputMode } from '../../shared/audio-input/types';

/**
 * Starts selected audio input(s) → STT for the product interview flow.
 *
 * Microphone / Meeting / Both are driven by publicConfig.audioInput.inputMode.
 * Simulation mode keeps listeningActive=false so this hook never starts meeting audio.
 */
export function useInterviewListening(active: boolean) {
  const micRef = useRef<BrowserCaptureHandle | null>(null);
  const meetingRef = useRef<BrowserCaptureHandle | null>(null);
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);

  const releaseAll = useCallback(() => {
    micRef.current?.stop();
    meetingRef.current?.stop();
    micRef.current = null;
    meetingRef.current = null;
    startedRef.current = false;
  }, []);

  useEffect(() => {
    const unsubscribe = window.companyAI.audio.onForceStop(() => {
      releaseAll();
    });
    return unsubscribe;
  }, [releaseAll]);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      if (!active) {
        micRef.current?.pause();
        meetingRef.current?.pause();
        return;
      }

      if (startedRef.current && (micRef.current || meetingRef.current)) {
        micRef.current?.resume();
        meetingRef.current?.resume();
        return;
      }

      setStarting(true);
      setError(null);
      setStatusHint(null);
      try {
        const configResult = await window.companyAI.config.getPublic();
        const audioInput = configResult.ok ? configResult.data.audioInput : null;
        const mode: AudioInputMode = audioInput?.inputMode ?? 'microphone';
        const micDeviceId = audioInput?.microphoneDeviceId ?? null;
        const meetingDeviceId = audioInput?.meetingAudioDeviceId ?? null;

        const usesMic = mode === 'microphone' || mode === 'microphone_and_meeting';
        const usesMeeting = mode === 'meeting_audio' || mode === 'microphone_and_meeting';

        if (usesMeeting) {
          if (!window.companyAI.audioInput) {
            setError('Meeting audio requires a full app restart. Close the app and run npm start again.');
            return;
          }
          const capability = await window.companyAI.audioInput.getCapability(mode);
          if (!capability.ok || !capability.data.supported) {
            setError(
              capability.ok
                ? (capability.data.reason ??
                    'Meeting/System Audio is unavailable on this device.')
                : capability.error.message,
            );
            return;
          }
          setStatusHint(
            'Meeting/System Audio will be processed by the interview assistant.',
          );
          await window.companyAI.audioInput.acknowledgeConsent();
          if (meetingDeviceId) {
            await window.companyAI.audioInput.selectDevice('meeting_audio', meetingDeviceId);
          } else {
            await window.companyAI.audioInput.selectDevice(
              'meeting_audio',
              'windows-system-loopback',
            );
          }
        }

        if (usesMic) {
          const permission = await queryMicrophonePermission();
          if (permission !== 'granted') {
            await window.companyAI.audio.beginPermissionRequest();
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: false,
            });
            for (const track of stream.getTracks()) track.stop();
            await window.companyAI.audio.setPermission('granted');
          }
          const devices = await enumerateInputDevices();
          await window.companyAI.audio.setDevices(devices);
          if (micDeviceId) {
            await window.companyAI.audio.selectDevice(micDeviceId);
            await window.companyAI.audioInput.selectDevice('microphone', micDeviceId);
          }
        } else {
          await window.companyAI.audio.setPermission('granted');
        }

        const sttConfig = await window.companyAI.stt.getConfigStatus();
        const sampleRate = sttConfig.ok ? sttConfig.data.sampleRate : 16000;

        if (sttConfig.ok && !sttConfig.data.configured && sttConfig.data.provider !== 'mock') {
          setError(
            'Speech recognition is not configured. Open Settings to connect your speech provider.',
          );
          return;
        }

        const startResult = await window.companyAI.audio.start({
          sampleRate,
          channels: 1,
          deviceId: micDeviceId ?? undefined,
        });
        if (!startResult.ok) {
          setError(friendlyAudioError(startResult.error.message));
          return;
        }
        if (cancelled) return;

        if (usesMic) {
          const handle = await startBrowserCapture({
            deviceId: startResult.data.selectedDeviceId ?? micDeviceId,
            sampleRate,
            onChunk: (chunk) => {
              void window.companyAI.audio.pushChunk(chunk);
            },
            onError: (message) => {
              setError(friendlyAudioError(message));
              releaseAll();
              void window.companyAI.audio.reportCaptureError(message);
            },
          });
          if (cancelled) {
            handle.stop();
            return;
          }
          micRef.current = handle;
        }

        if (usesMeeting) {
          const handle = await startMeetingAudioCapture({
            sampleRate,
            onChunk: (chunk) => {
              void window.companyAI.audio.pushChunk(chunk);
            },
            onError: (message) => {
              setError(friendlyAudioError(message));
              releaseAll();
              void window.companyAI.audio.reportCaptureError(message);
            },
          });
          if (cancelled) {
            handle.stop();
            return;
          }
          meetingRef.current = handle;
        }

        const confirm = await window.companyAI.audio.confirmActive();
        if (!confirm.ok) {
          setError(friendlyAudioError(confirm.error.message));
          releaseAll();
          return;
        }
        // Optional: notify main of active sources (confirmActive already marks them).
        if (window.companyAI.audioInput?.markSourceActive) {
          if (usesMic) {
            void window.companyAI.audioInput.markSourceActive('microphone').catch(() => undefined);
          }
          if (usesMeeting) {
            void window.companyAI.audioInput
              .markSourceActive('meeting_audio')
              .catch(() => undefined);
          }
        }
        await window.companyAI.interview.markListening();
        startedRef.current = true;
      } catch (error) {
        setError(friendlyAudioError(error instanceof Error ? error.message : 'Audio start failed'));
        releaseAll();
      } finally {
        if (!cancelled) setStarting(false);
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [active, releaseAll]);

  useEffect(() => {
    return () => {
      releaseAll();
    };
  }, [releaseAll]);

  return { error, starting, statusHint };
}

function friendlyAudioError(message: string): string {
  if (/permission|NotAllowed|denied/i.test(message)) {
    return 'Permission is required to capture the selected audio source.';
  }
  if (/not configured|speech recognition/i.test(message)) {
    return 'Speech recognition is not configured. Open Settings to connect your speech provider.';
  }
  if (/unavailable|unsupported|Meeting\/System Audio is unavailable/i.test(message)) {
    return 'Meeting/System Audio is unavailable on this device.';
  }
  if (/interrupt|disconnect|closed|network|WebSocket|Deepgram|ECONN|ETIMEDOUT/i.test(message)) {
    return 'Your audio connection was interrupted.';
  }
  if (
    /stack|ENOENT|EACCES|at\s+\S+\s+\(|[A-Za-z]:\\|\/Users\//i.test(message) ||
    message.length > 180
  ) {
    return 'Something went wrong with audio capture. Try Pause and Resume.';
  }
  return message;
}
