import { useCallback, useEffect, useRef, useState } from 'react';
import {
  enumerateInputDevices,
  queryMicrophonePermission,
  startBrowserCapture,
  type BrowserCaptureHandle,
} from '../audio/browserCapture';

/**
 * Starts microphone → STT for the product interview flow.
 *
 * Lifecycle:
 * - active=true (first time): permission → audio.start → browser capture → confirm
 * - active=false (pause): pause local capture only (InterviewHost disconnects STT)
 * - active=true again: resume local capture (InterviewHost reconnects STT)
 * - unmount / force-stop: release mic; session end owns STT teardown
 */
export function useInterviewListening(active: boolean) {
  const captureRef = useRef<BrowserCaptureHandle | null>(null);
  const startedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const releaseMic = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    startedRef.current = false;
  }, []);

  useEffect(() => {
    const unsubscribe = window.companyAI.audio.onForceStop(() => {
      releaseMic();
    });
    return unsubscribe;
  }, [releaseMic]);

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      if (!active) {
        captureRef.current?.pause();
        return;
      }

      if (captureRef.current && startedRef.current) {
        captureRef.current.resume();
        return;
      }

      setStarting(true);
      setError(null);
      try {
        const permission = await queryMicrophonePermission();
        if (permission !== 'granted') {
          await window.companyAI.audio.beginPermissionRequest();
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          for (const track of stream.getTracks()) track.stop();
          await window.companyAI.audio.setPermission('granted');
        }

        const devices = await enumerateInputDevices();
        await window.companyAI.audio.setDevices(devices);
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
        });
        if (!startResult.ok) {
          setError(friendlyMicError(startResult.error.message));
          return;
        }
        if (cancelled) return;

        const handle = await startBrowserCapture({
          deviceId: startResult.data.selectedDeviceId,
          sampleRate,
          onChunk: (chunk) => {
            void window.companyAI.audio.pushChunk(chunk);
          },
          onError: (message) => {
            setError(friendlyMicError(message));
            releaseMic();
            void window.companyAI.audio.reportCaptureError(message);
          },
        });
        if (cancelled) {
          handle.stop();
          return;
        }
        captureRef.current = handle;
        startedRef.current = true;
        await window.companyAI.audio.confirmActive();
        await window.companyAI.interview.markListening();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Could not start microphone listening.';
        setError(friendlyMicError(message));
        releaseMic();
      } finally {
        if (!cancelled) setStarting(false);
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
  }, [active, releaseMic]);

  useEffect(() => {
    return () => {
      releaseMic();
    };
  }, [releaseMic]);

  return { error, starting, stop: releaseMic };
}

function friendlyMicError(message: string): string {
  if (/permission|NotAllowed|denied/i.test(message)) {
    return 'Microphone permission is required to listen during the interview.';
  }
  if (/not configured|speech recognition/i.test(message)) {
    return 'Speech recognition is not configured. Open Settings to connect your speech provider.';
  }
  if (/interrupt|disconnect|closed|network|WebSocket|Deepgram|ECONN|ETIMEDOUT/i.test(message)) {
    return 'Your microphone connection was interrupted.';
  }
  if (/stack|ENOENT|EACCES|at\s+\S+\s+\(|[A-Za-z]:\\|\/Users\//i.test(message) || message.length > 180) {
    return 'Something went wrong with the microphone. Try Pause and Resume.';
  }
  return message;
}
