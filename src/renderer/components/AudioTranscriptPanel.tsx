import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AudioCaptureStatus,
  AudioDeviceInfo,
  MicrophonePermissionStatus,
} from '../../shared/audio/types';
import type { TranscriptSegment } from '../../shared/transcription/types';
import type { SttConfigStatus, STTProviderStatus } from '../../shared/stt/types';
import { STT_DEEPGRAM_CREDENTIAL_KEY } from '../../shared/config/types';
import {
  enumerateInputDevices,
  queryMicrophonePermission,
  startBrowserCapture,
  type BrowserCaptureHandle,
} from '../audio/browserCapture';
import './audioTranscriptPanel.css';

const IDLE_STATUS: AudioCaptureStatus = {
  state: 'idle',
  permission: 'unknown',
  selectedDeviceId: null,
  errorMessage: null,
  active: false,
};

function permissionLabel(permission: MicrophonePermissionStatus): string {
  switch (permission) {
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Denied';
    case 'unavailable':
      return 'Unavailable';
    case 'required':
      return 'Required';
    default:
      return 'Unknown';
  }
}

function captureStatusLabel(state: AudioCaptureStatus['state']): string {
  switch (state) {
    case 'active':
      return 'Active';
    case 'starting':
      return 'Starting';
    case 'paused':
      return 'Paused';
    case 'stopping':
      return 'Stopping';
    case 'stopped':
      return 'Stopped';
    case 'requesting_permission':
      return 'Requesting permission';
    case 'ready':
      return 'Ready';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

function sttStatusLabel(status: STTProviderStatus['status']): string {
  switch (status) {
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'streaming':
      return 'Streaming';
    case 'reconnecting':
      return 'Reconnecting';
    case 'error':
      return 'Error';
    default:
      return 'Disconnected';
  }
}

export function AudioTranscriptPanel() {
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [audioStatus, setAudioStatus] = useState<AudioCaptureStatus>(IDLE_STATUS);
  const [sttStatus, setSttStatus] = useState<STTProviderStatus>({
    status: 'disconnected',
    errorMessage: null,
    provider: 'deepgram',
    configured: false,
    recoverable: false,
    metrics: {
      connectionLatencyMs: null,
      lastChunkSendLatencyMs: null,
      lastPartialLatencyMs: null,
      lastFinalLatencyMs: null,
      chunksSent: 0,
      partialsReceived: 0,
      finalsReceived: 0,
    },
  });
  const [sttConfig, setSttConfig] = useState<SttConfigStatus | null>(null);
  const [partialText, setPartialText] = useState<string | null>(null);
  const [finals, setFinals] = useState<TranscriptSegment[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const captureRef = useRef<BrowserCaptureHandle | null>(null);

  const stopLocalCapture = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
  }, []);

  const refreshDevices = useCallback(async () => {
    const listed = await enumerateInputDevices();
    setDevices(listed);
    const api = window.companyAI;
    const result = await api.audio.setDevices(listed);
    if (!result.ok) {
      setLocalError(result.error.message);
    }
  }, []);

  const syncPermission = useCallback(async () => {
    const permission = await queryMicrophonePermission();
    const result = await window.companyAI.audio.setPermission(permission);
    if (result.ok) {
      setAudioStatus(result.data);
    }
  }, []);

  const refreshSttConfig = useCallback(async () => {
    const result = await window.companyAI.stt.getConfigStatus();
    if (result.ok) {
      setSttConfig(result.data);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    async function bootstrap() {
      try {
        const [statusResult, snapshotResult, sttResult] = await Promise.all([
          window.companyAI.audio.getStatus(),
          window.companyAI.transcript.getSnapshot(),
          window.companyAI.stt.getStatus(),
        ]);
        if (cancelled) {
          return;
        }
        if (statusResult.ok) {
          setAudioStatus(statusResult.data);
        }
        if (snapshotResult.ok) {
          setPartialText(snapshotResult.data.partialText);
          setFinals(snapshotResult.data.finals);
        }
        if (sttResult.ok) {
          setSttStatus(sttResult.data);
        }
        await refreshDevices();
        await syncPermission();
        await refreshSttConfig();
      } catch (error) {
        if (!cancelled) {
          setLocalError(error instanceof Error ? error.message : 'Audio panel failed to load');
        }
      }
    }

    void bootstrap();

    unsubscribers.push(
      window.companyAI.audio.onStatusChanged((status) => {
        setAudioStatus(status);
      }),
    );
    unsubscribers.push(
      window.companyAI.audio.onForceStop(() => {
        stopLocalCapture();
      }),
    );
    unsubscribers.push(
      window.companyAI.transcript.onPartial((event) => {
        setPartialText(event.segment?.text ?? null);
      }),
    );
    unsubscribers.push(
      window.companyAI.transcript.onFinal((event) => {
        if (event.segment) {
          setFinals((prev) => [...prev.slice(-199), event.segment!]);
        }
        setPartialText(null);
      }),
    );
    unsubscribers.push(
      window.companyAI.transcript.onError((event) => {
        setLocalError(event.message ?? 'Transcript error');
      }),
    );
    unsubscribers.push(
      window.companyAI.stt.onStatusChanged((status) => {
        setSttStatus(status);
      }),
    );

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      stopLocalCapture();
    };
  }, [refreshDevices, refreshSttConfig, stopLocalCapture, syncPermission]);

  async function handleSelectDevice(deviceId: string) {
    setLocalError(null);
    const result = await window.companyAI.audio.selectDevice(deviceId || null);
    if (!result.ok) {
      setLocalError(result.error.message);
      return;
    }
    setAudioStatus(result.data);
  }

  async function handleRequestPermission() {
    setBusy(true);
    setLocalError(null);
    try {
      await window.companyAI.audio.beginPermissionRequest();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      const granted = await window.companyAI.audio.setPermission('granted');
      if (granted.ok) {
        setAudioStatus(granted.data);
      }
      await refreshDevices();
    } catch {
      const denied = await window.companyAI.audio.setPermission('denied');
      if (denied.ok) {
        setAudioStatus(denied.data);
      }
      setLocalError('Microphone permission denied or unavailable');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveApiKey() {
    setBusy(true);
    setLocalError(null);
    try {
      const value = apiKeyDraft.trim();
      if (!value) {
        setLocalError('Enter a Deepgram API key');
        return;
      }
      const result = await window.companyAI.credentials.set(STT_DEEPGRAM_CREDENTIAL_KEY, value);
      setApiKeyDraft('');
      if (!result.ok) {
        setLocalError(result.error.message);
        return;
      }
      await refreshSttConfig();
    } finally {
      setBusy(false);
    }
  }

  async function handleClearApiKey() {
    setBusy(true);
    setLocalError(null);
    try {
      const result = await window.companyAI.credentials.delete(STT_DEEPGRAM_CREDENTIAL_KEY);
      if (!result.ok) {
        setLocalError(result.error.message);
        return;
      }
      await refreshSttConfig();
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    setBusy(true);
    setLocalError(null);
    try {
      if (audioStatus.permission !== 'granted') {
        setLocalError('Grant microphone permission before starting audio');
        return;
      }
      if (sttConfig && !sttConfig.configured && sttConfig.provider !== 'mock') {
        setLocalError('Configure the Deepgram API key before starting transcription');
        return;
      }

      const startResult = await window.companyAI.audio.start({
        deviceId: audioStatus.selectedDeviceId ?? undefined,
        sampleRate: sttConfig?.sampleRate ?? 16000,
        channels: sttConfig?.channels ?? 1,
      });
      if (!startResult.ok) {
        setLocalError(startResult.error.message);
        return;
      }
      setAudioStatus(startResult.data);

      const handle = await startBrowserCapture({
        deviceId: audioStatus.selectedDeviceId,
        sampleRate: sttConfig?.sampleRate ?? 16000,
        onChunk: (chunk) => {
          void window.companyAI.audio.pushChunk(chunk);
        },
        onError: (message) => {
          void window.companyAI.audio.reportCaptureError(message);
          setLocalError(message);
          stopLocalCapture();
        },
      });
      captureRef.current = handle;

      const active = await window.companyAI.audio.confirmActive();
      if (active.ok) {
        setAudioStatus(active.data);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start microphone capture';
      setLocalError(message);
      stopLocalCapture();
      await window.companyAI.audio.reportCaptureError(message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    setBusy(true);
    setLocalError(null);
    try {
      captureRef.current?.pause();
      const result = await window.companyAI.audio.pause();
      if (!result.ok) {
        setLocalError(result.error.message);
        return;
      }
      setAudioStatus(result.data);
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    setBusy(true);
    setLocalError(null);
    try {
      captureRef.current?.resume();
      const result = await window.companyAI.audio.resume();
      if (!result.ok) {
        setLocalError(result.error.message);
        return;
      }
      setAudioStatus(result.data);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    setLocalError(null);
    try {
      stopLocalCapture();
      const result = await window.companyAI.audio.stop();
      if (!result.ok) {
        setLocalError(result.error.message);
        return;
      }
      setAudioStatus(result.data);
    } finally {
      setBusy(false);
    }
  }

  async function handleClearTranscript() {
    const result = await window.companyAI.transcript.clear();
    if (result.ok) {
      setPartialText(result.data.partialText);
      setFinals(result.data.finals);
    }
  }

  const selectedDeviceId = audioStatus.selectedDeviceId ?? '';
  const canStart =
    !busy &&
    audioStatus.permission === 'granted' &&
    (audioStatus.state === 'idle' ||
      audioStatus.state === 'ready' ||
      audioStatus.state === 'stopped');
  const canPause = !busy && audioStatus.state === 'active';
  const canResume = !busy && audioStatus.state === 'paused';
  const canStop =
    !busy &&
    (audioStatus.state === 'active' ||
      audioStatus.state === 'paused' ||
      audioStatus.state === 'starting');

  return (
    <section className="audio-panel" aria-label="Audio input and live transcript">
      <div className="audio-panel__block">
        <div className="audio-panel__heading">
          <h2>Audio Input</h2>
          <span
            className={`audio-panel__mic ${audioStatus.active ? 'is-active' : 'is-idle'}`}
            role="status"
            aria-live="polite"
          >
            {audioStatus.active ? 'MICROPHONE ACTIVE' : 'MICROPHONE OFF'}
          </span>
        </div>

        <label className="audio-panel__field">
          <span>Microphone</span>
          <select
            value={selectedDeviceId}
            onChange={(event) => {
              void handleSelectDevice(event.target.value);
            }}
            disabled={audioStatus.active || audioStatus.state === 'paused'}
          >
            <option value="">System default</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>

        <dl className="audio-panel__meta">
          <div>
            <dt>Permission</dt>
            <dd>{permissionLabel(audioStatus.permission)}</dd>
          </div>
          <div>
            <dt>Microphone</dt>
            <dd>{captureStatusLabel(audioStatus.state)}</dd>
          </div>
          <div>
            <dt>STT Provider</dt>
            <dd>{sttConfig?.provider ?? sttStatus.provider}</dd>
          </div>
          <div>
            <dt>STT Status</dt>
            <dd>{sttStatusLabel(sttStatus.status)}</dd>
          </div>
          <div>
            <dt>STT Credential</dt>
            <dd>{sttConfig?.configured ? 'Configured' : 'Not configured'}</dd>
          </div>
          <div>
            <dt>Latency</dt>
            <dd>
              {sttStatus.metrics.connectionLatencyMs != null
                ? `${sttStatus.metrics.connectionLatencyMs} ms connect`
                : '—'}
            </dd>
          </div>
        </dl>

        <div className="audio-panel__credential">
          <label className="audio-panel__field">
            <span>Deepgram API key (stored in vault — never shown again)</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              placeholder={sttConfig?.configured ? '•••••••• (replace)' : 'Enter API key'}
              disabled={busy}
            />
          </label>
          <div className="audio-panel__actions">
            <button type="button" onClick={() => void handleSaveApiKey()} disabled={busy}>
              Save key
            </button>
            <button type="button" onClick={() => void handleClearApiKey()} disabled={busy}>
              Clear key
            </button>
          </div>
        </div>

        {audioStatus.errorMessage ? (
          <p className="audio-panel__error" role="alert">
            {audioStatus.errorMessage}
          </p>
        ) : null}
        {sttStatus.errorMessage ? (
          <p className="audio-panel__error" role="alert">
            STT: {sttStatus.errorMessage}
          </p>
        ) : null}
        {localError ? (
          <p className="audio-panel__error" role="alert">
            {localError}
          </p>
        ) : null}

        <div className="audio-panel__actions">
          <button type="button" onClick={() => void handleRequestPermission()} disabled={busy}>
            Request permission
          </button>
          <button type="button" onClick={() => void refreshDevices()} disabled={busy}>
            Refresh devices
          </button>
          <button type="button" onClick={() => void handleStart()} disabled={!canStart}>
            Start
          </button>
          <button type="button" onClick={() => void handlePause()} disabled={!canPause}>
            Pause
          </button>
          <button type="button" onClick={() => void handleResume()} disabled={!canResume}>
            Resume
          </button>
          <button type="button" onClick={() => void handleStop()} disabled={!canStop}>
            Stop
          </button>
        </div>
      </div>

      <div className="audio-panel__block">
        <div className="audio-panel__heading">
          <h2>Live Transcript</h2>
          <span className="audio-panel__live" role="status">
            {sttStatus.status === 'streaming' || audioStatus.active ? 'LIVE' : 'IDLE'}
          </span>
          <button type="button" className="audio-panel__ghost" onClick={() => void handleClearTranscript()}>
            Clear
          </button>
        </div>

        <div className="audio-panel__partial">
          <h3>Partial</h3>
          <p>{partialText ?? '—'}</p>
        </div>

        <div className="audio-panel__finals">
          <h3>Final</h3>
          {finals.length === 0 ? (
            <p className="audio-panel__empty">
              No final segments yet. Speak after Start when Deepgram is configured.
            </p>
          ) : (
            <ul>
              {finals.map((segment) => (
                <li key={segment.id}>{segment.text}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
