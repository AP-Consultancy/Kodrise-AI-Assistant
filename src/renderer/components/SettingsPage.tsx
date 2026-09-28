import { useEffect, useState } from 'react';
import {
  AI_GEMINI_CREDENTIAL_KEY,
  AI_OPENAI_CREDENTIAL_KEY,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  defaultModelForProvider,
} from '../../shared/ai/types';
import type { AIProviderId } from '../../shared/ai/types';
import { STT_DEEPGRAM_CREDENTIAL_KEY } from '../../shared/config/types';
import type { CapturePolicyId } from '../../shared/capture-policy/types';
import { CAPTURE_POLICY_OPTIONS } from '../../shared/capture-policy/types';
import type { AudioInputMode, AudioInputDevice } from '../../shared/audio-input/types';
import type {
  AppearanceBlurLevel,
  AppearanceContentClarity,
  AppearanceIntensity,
  AppearancePublicConfig,
} from '../../shared/config/types';
import {
  DEFAULT_APPEARANCE_PUBLIC_CONFIG,
  DEFAULT_QUESTION_CAPTURE_CONFIG,
} from '../../shared/config/types';
import type {
  QuestionCaptureMode,
  QuestionCapturePublicConfig,
} from '../../shared/question-capture/types';
import { enumerateInputDevices } from '../audio/browserCapture';
import './settingsPage.css';

interface SettingsPageProps {
  onOpenDiagnostics: () => void;
  onAppearanceChanged?: (appearance: AppearancePublicConfig) => void;
}

export function SettingsPage({ onOpenDiagnostics, onAppearanceChanged }: SettingsPageProps) {
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [sttConfigured, setSttConfigured] = useState(false);
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [sttKey, setSttKey] = useState('');
  const [aiProvider, setAiProvider] = useState<AIProviderId>('openai');
  const [aiModel, setAiModel] = useState(DEFAULT_OPENAI_MODEL);
  const [windowPrivacyPolicy, setWindowPrivacyPolicy] =
    useState<CapturePolicyId>('STANDARD');
  const [protectionEnabled, setProtectionEnabled] = useState(false);
  const [audioInputMode, setAudioInputMode] = useState<AudioInputMode>('microphone');
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState<string | null>(null);
  const [meetingAudioDeviceId, setMeetingAudioDeviceId] = useState<string | null>(null);
  const [micDevices, setMicDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [meetingDevices, setMeetingDevices] = useState<AudioInputDevice[]>([]);
  const [meetingCapabilityNote, setMeetingCapabilityNote] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<AppearancePublicConfig>(
    DEFAULT_APPEARANCE_PUBLIC_CONFIG,
  );
  const [questionCapture, setQuestionCapture] = useState<QuestionCapturePublicConfig>(
    DEFAULT_QUESTION_CAPTURE_CONFIG,
  );
  const [hotkeyDraft, setHotkeyDraft] = useState(DEFAULT_QUESTION_CAPTURE_CONFIG.hotkey);
  const [hotkeyStatus, setHotkeyStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [openai, gemini, stt, config, captureStatus] = await Promise.all([
      window.companyAI.credentials.has(AI_OPENAI_CREDENTIAL_KEY),
      window.companyAI.credentials.has(AI_GEMINI_CREDENTIAL_KEY),
      window.companyAI.credentials.has(STT_DEEPGRAM_CREDENTIAL_KEY),
      window.companyAI.config.getPublic(),
      window.companyAI.capture.getStatus(),
    ]);
    if (openai.ok) setOpenaiConfigured(openai.data.configured);
    if (gemini.ok) setGeminiConfigured(gemini.data.configured);
    if (stt.ok) setSttConfigured(stt.data.configured);
    if (config.ok) {
      setAiProvider(config.data.ai.provider);
      setAiModel(config.data.ai.model);
      setWindowPrivacyPolicy(config.data.capture.windowPrivacyPolicy);
      setAudioInputMode(config.data.audioInput?.inputMode ?? 'microphone');
      setMicrophoneDeviceId(config.data.audioInput?.microphoneDeviceId ?? null);
      setMeetingAudioDeviceId(config.data.audioInput?.meetingAudioDeviceId ?? null);
      const nextAppearance = {
        ...DEFAULT_APPEARANCE_PUBLIC_CONFIG,
        ...(config.data.appearance ?? {}),
      };
      setAppearance(nextAppearance);
      onAppearanceChanged?.(nextAppearance);
      const nextCapture = {
        ...DEFAULT_QUESTION_CAPTURE_CONFIG,
        ...(config.data.questionCapture ?? {}),
      };
      setQuestionCapture(nextCapture);
      setHotkeyDraft(nextCapture.hotkey);
      const captureStatus = await window.companyAI.questionCapture.getStatus();
      if (captureStatus.ok) {
        setHotkeyStatus(
          captureStatus.data.hotkeyRegistered
            ? `Registered: ${captureStatus.data.hotkey}`
            : captureStatus.data.hotkeyError,
        );
      }
    }
    if (captureStatus.ok) {
      setWindowPrivacyPolicy(captureStatus.data.policy);
      setProtectionEnabled(captureStatus.data.contentProtectionEnabled);
    }

    if (window.companyAI.audioInput) {
      const [audioInputStatus, meetingEnum] = await Promise.all([
        window.companyAI.audioInput.getStatus(),
        window.companyAI.audioInput.enumerateDevices(),
      ]);
      if (audioInputStatus.ok) {
        setAudioInputMode(audioInputStatus.data.mode);
        setMicrophoneDeviceId(audioInputStatus.data.microphoneDeviceId);
        setMeetingAudioDeviceId(audioInputStatus.data.meetingAudioDeviceId);
        if (!audioInputStatus.data.capability.meetingAudioAvailable) {
          setMeetingCapabilityNote(
            audioInputStatus.data.capability.reason ??
              'Meeting/System Audio is unavailable on this device.',
          );
        } else {
          setMeetingCapabilityNote(null);
        }
      }
      if (meetingEnum.ok) setMeetingDevices(meetingEnum.data);
    }

    try {
      const mics = await enumerateInputDevices();
      setMicDevices(mics.map((d) => ({ deviceId: d.deviceId, label: d.label })));
    } catch {
      setMicDevices([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        if (cancelled) return;
        await refresh();
      })();
    });
    const unsub = window.companyAI.capture.onPolicyChanged(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  async function saveKey(key: string, value: string, label: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const trimmed = value.trim();
      if (!trimmed) {
        setError(`Enter a ${label} key`);
        return;
      }
      const result = await window.companyAI.credentials.set(key, trimmed);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMessage(`${label} configured`);
      if (key === AI_OPENAI_CREDENTIAL_KEY) setOpenaiKey('');
      if (key === AI_GEMINI_CREDENTIAL_KEY) setGeminiKey('');
      if (key === STT_DEEPGRAM_CREDENTIAL_KEY) setSttKey('');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clearKey(key: string, label: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.companyAI.credentials.delete(key);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMessage(`${label} key cleared`);
      if (key === AI_OPENAI_CREDENTIAL_KEY) setOpenaiKey('');
      if (key === AI_GEMINI_CREDENTIAL_KEY) setGeminiKey('');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setAnswerEngine(provider: AIProviderId) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const model = defaultModelForProvider(provider);
      const result = await window.companyAI.config.update({
        ai: { provider, model },
      } as Parameters<typeof window.companyAI.config.update>[0]);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setAiProvider(result.data.ai.provider);
      setAiModel(result.data.ai.model);
      setMessage(
        provider === 'mock'
          ? 'Mock AI enabled — answers work offline without API credits.'
          : provider === 'gemini'
            ? 'Gemini enabled — requires a Gemini API key.'
            : 'OpenAI enabled — requires a working API key and quota.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveGeminiModel(model: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const trimmed = model.trim() || DEFAULT_GEMINI_MODEL;
      const result = await window.companyAI.config.update({
        ai: { model: trimmed },
      } as Parameters<typeof window.companyAI.config.update>[0]);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setAiModel(result.data.ai.model);
      setMessage('Gemini model saved');
    } finally {
      setBusy(false);
    }
  }

  async function testAiConnection() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.companyAI.ai.testConnection();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (result.data.success) {
        setMessage(
          `${result.data.message}${
            result.data.latencyMs != null ? ` (${result.data.latencyMs} ms)` : ''
          }`,
        );
      } else {
        const diagnostic =
          result.data.diagnosticCode ?? result.data.category;
        setError(
          diagnostic
            ? `${result.data.message} [${diagnostic}]`
            : result.data.message,
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function setWindowCaptureProtection(policy: CapturePolicyId) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.companyAI.capture.applyPolicy(policy);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setWindowPrivacyPolicy(result.data.policy);
      setProtectionEnabled(result.data.contentProtectionEnabled);
      if (!result.data.success && policy === 'PRIVACY_AWARE') {
        setError(result.data.message);
      } else {
        const option = CAPTURE_POLICY_OPTIONS.find((item) => item.id === result.data.policy);
        setMessage(
          `Window Capture Protection set to ${option?.label ?? result.data.policy}.`,
        );
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function changeAudioInputMode(mode: AudioInputMode) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const capability = await window.companyAI.audioInput.getCapability(mode);
      if (capability.ok && mode !== 'microphone' && !capability.data.supported) {
        setError(
          capability.data.reason ?? 'Meeting/System Audio is unavailable on this device.',
        );
        return;
      }
      const result = await window.companyAI.audioInput.setMode(mode);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setAudioInputMode(result.data.mode);
      setMessage(
        mode === 'microphone'
          ? 'Audio Input set to Microphone.'
          : mode === 'meeting_audio'
            ? 'Audio Input set to Meeting / System Audio.'
            : 'Audio Input set to Microphone + Meeting Audio.',
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function changeMicDevice(deviceId: string) {
    setBusy(true);
    try {
      const id = deviceId || null;
      await window.companyAI.audioInput.selectDevice('microphone', id);
      if (id) await window.companyAI.audio.selectDevice(id);
      setMicrophoneDeviceId(id);
    } finally {
      setBusy(false);
    }
  }

  async function changeMeetingDevice(deviceId: string) {
    setBusy(true);
    try {
      const id = deviceId || null;
      await window.companyAI.audioInput.selectDevice('meeting_audio', id);
      setMeetingAudioDeviceId(id);
    } finally {
      setBusy(false);
    }
  }

  const [settingsPane, setSettingsPane] = useState<
    'ai' | 'audio' | 'appearance' | 'privacy' | 'advanced'
  >('ai');

  async function saveAppearance(patch: Partial<AppearancePublicConfig>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = { ...appearance, ...patch };
      const result = await window.companyAI.config.update({
        appearance: next,
      } as Parameters<typeof window.companyAI.config.update>[0]);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const saved = result.data.appearance ?? next;
      setAppearance(saved);
      onAppearanceChanged?.(saved);
      setMessage('Appearance saved');
    } finally {
      setBusy(false);
    }
  }

  async function saveQuestionCapture(patch: Partial<QuestionCapturePublicConfig>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await window.companyAI.questionCapture.updateConfig(patch);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setQuestionCapture({
        hotkey: result.data.hotkey,
        captureMode: result.data.captureMode,
      });
      setHotkeyDraft(result.data.hotkey);
      setHotkeyStatus(
        result.data.hotkeyRegistered
          ? `Registered: ${result.data.hotkey}`
          : result.data.hotkeyError,
      );
      setMessage('Question capture settings saved');
    } finally {
      setBusy(false);
    }
  }

  const providerLabel =
    aiProvider === 'mock' ? 'Mock AI (offline)' : aiProvider === 'gemini' ? 'Gemini' : 'OpenAI';

  return (
    <section className="settings" aria-labelledby="settings-title">
      <nav className="settings__nav" aria-label="Settings sections">
        <p className="settings__nav-title" id="settings-title">
          Settings
        </p>
        {(
          [
            { id: 'ai', label: 'AI' },
            { id: 'audio', label: 'Audio' },
            { id: 'appearance', label: 'Appearance' },
            { id: 'privacy', label: 'Privacy' },
            { id: 'advanced', label: 'Advanced' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              settingsPane === item.id ? 'settings__nav-item is-active' : 'settings__nav-item'
            }
            aria-current={settingsPane === item.id ? 'page' : undefined}
            onClick={() => setSettingsPane(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="settings__panel">
        {error ? (
          <p className="settings__error" role="alert">
            {error}
          </p>
        ) : null}
        {message ? <p className="settings__ok">{message}</p> : null}

        {settingsPane === 'ai' ? (
          <>
            <h1>AI</h1>
            <p className="settings__lede">
              Choose a provider. API keys stay in the vault and are never shown after saving.
            </p>

            <div className="settings__group">
              <h2>Answer engine</h2>
              <p className="settings__status">{providerLabel}</p>
              <label htmlFor="ai-provider">Provider</label>
              <select
                id="ai-provider"
                value={aiProvider}
                disabled={busy}
                onChange={(event) => void setAnswerEngine(event.target.value as AIProviderId)}
              >
                <option value="mock">Mock AI</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
              <div className="settings__row">
                <button
                  type="button"
                  className={
                    aiProvider === 'mock'
                      ? 'settings__choice settings__choice--active'
                      : 'settings__choice'
                  }
                  disabled={busy || aiProvider === 'mock'}
                  onClick={() => void setAnswerEngine('mock')}
                >
                  Mock
                </button>
                <button
                  type="button"
                  className={
                    aiProvider === 'openai'
                      ? 'settings__choice settings__choice--active'
                      : 'settings__choice'
                  }
                  disabled={busy || aiProvider === 'openai'}
                  onClick={() => void setAnswerEngine('openai')}
                >
                  OpenAI
                </button>
                <button
                  type="button"
                  className={
                    aiProvider === 'gemini'
                      ? 'settings__choice settings__choice--active'
                      : 'settings__choice'
                  }
                  disabled={busy || aiProvider === 'gemini'}
                  onClick={() => void setAnswerEngine('gemini')}
                >
                  Gemini
                </button>
              </div>
              <button type="button" disabled={busy} onClick={() => void testAiConnection()}>
                Test Connection
              </button>
            </div>

            <div className="settings__group">
              <h2>OpenAI</h2>
              <p className="settings__status">
                {openaiConfigured ? 'Configured' : 'Not configured'}
              </p>
              <label htmlFor="openai-key">API key</label>
              <input
                id="openai-key"
                type="password"
                autoComplete="off"
                value={openaiKey}
                onChange={(event) => setOpenaiKey(event.target.value)}
                placeholder={openaiConfigured ? '•••••••••••••••' : 'Paste key — it will not be shown again'}
                disabled={busy}
              />
              <div className="settings__row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveKey(AI_OPENAI_CREDENTIAL_KEY, openaiKey, 'OpenAI')}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={busy || !openaiConfigured}
                  onClick={() => void clearKey(AI_OPENAI_CREDENTIAL_KEY, 'OpenAI')}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="settings__group">
              <h2>Gemini</h2>
              <p className="settings__status">
                {geminiConfigured ? 'Configured' : 'Not configured'}
              </p>
              <label htmlFor="gemini-model">Model</label>
              <input
                id="gemini-model"
                type="text"
                value={aiProvider === 'gemini' ? aiModel : DEFAULT_GEMINI_MODEL}
                onChange={(event) => setAiModel(event.target.value)}
                disabled={busy || aiProvider !== 'gemini'}
              />
              {aiProvider === 'gemini' ? (
                <button type="button" disabled={busy} onClick={() => void saveGeminiModel(aiModel)}>
                  Save model
                </button>
              ) : null}
              <label htmlFor="gemini-key">API key</label>
              <input
                id="gemini-key"
                type="password"
                autoComplete="off"
                value={geminiKey}
                onChange={(event) => setGeminiKey(event.target.value)}
                placeholder={geminiConfigured ? '•••••••••••••••' : 'Paste key — it will not be shown again'}
                disabled={busy}
              />
              <div className="settings__row">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveKey(AI_GEMINI_CREDENTIAL_KEY, geminiKey, 'Gemini')}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={busy || !geminiConfigured}
                  onClick={() => void clearKey(AI_GEMINI_CREDENTIAL_KEY, 'Gemini')}
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={busy || aiProvider !== 'gemini'}
                  onClick={() => void testAiConnection()}
                >
                  Test Connection
                </button>
              </div>
            </div>
          </>
        ) : null}

        {settingsPane === 'audio' ? (
          <>
            <h1>Audio</h1>
            <p className="settings__lede">
              Speech recognition and which input the assistant listens to.
            </p>

            <div className="settings__group">
              <h2>Speech (Deepgram)</h2>
              <p className="settings__status">{sttConfigured ? 'Configured' : 'Not configured'}</p>
              <label htmlFor="stt-key">API key</label>
              <input
                id="stt-key"
                type="password"
                autoComplete="off"
                value={sttKey}
                onChange={(event) => setSttKey(event.target.value)}
                placeholder="Paste key — it will not be shown again"
                disabled={busy}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveKey(STT_DEEPGRAM_CREDENTIAL_KEY, sttKey, 'Speech')}
              >
                Save speech key
              </button>
            </div>

            <div className="settings__group" aria-labelledby="audio-input-heading">
              <h2 id="audio-input-heading">Audio input</h2>
              <p className="settings__lede">
                Meeting audio starts only when an interview begins — never at app launch.
              </p>
              {meetingCapabilityNote ? (
                <p className="settings__error" role="status">
                  {meetingCapabilityNote}
                </p>
              ) : null}
              <label htmlFor="audio-input-mode">Mode</label>
              <select
                id="audio-input-mode"
                value={audioInputMode}
                disabled={busy}
                onChange={(event) => void changeAudioInputMode(event.target.value as AudioInputMode)}
              >
                <option value="microphone">Microphone</option>
                <option value="meeting_audio">Meeting / System Audio</option>
                <option value="microphone_and_meeting">Microphone + Meeting Audio</option>
              </select>
              {(audioInputMode === 'microphone' || audioInputMode === 'microphone_and_meeting') && (
                <>
                  <label htmlFor="mic-device">Microphone</label>
                  <select
                    id="mic-device"
                    value={microphoneDeviceId ?? ''}
                    disabled={busy}
                    onChange={(event) => void changeMicDevice(event.target.value)}
                  >
                    <option value="">Default microphone</option>
                    {micDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {(audioInputMode === 'meeting_audio' ||
                audioInputMode === 'microphone_and_meeting') && (
                <>
                  <label htmlFor="meeting-device">Meeting audio device</label>
                  <select
                    id="meeting-device"
                    value={meetingAudioDeviceId ?? ''}
                    disabled={busy || Boolean(meetingCapabilityNote)}
                    onChange={(event) => void changeMeetingDevice(event.target.value)}
                  >
                    <option value="">Select device</option>
                    {meetingDevices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          </>
        ) : null}

        {settingsPane === 'appearance' ? (
          <>
            <h1>Appearance</h1>
            <p className="settings__lede">
              Window transparency lets your desktop show through the glass surfaces. Separate from
              privacy capture protection.
            </p>

            <div className="settings__group">
              <h2>Question Capture Hotkey</h2>
              <p className="settings__hint">
                Press the hotkey during a live interview to select a question region. Capture is
                always explicit — nothing is monitored in the background.
              </p>
              <label htmlFor="question-capture-hotkey">Hotkey</label>
              <input
                id="question-capture-hotkey"
                value={hotkeyDraft}
                disabled={busy}
                onChange={(event) => setHotkeyDraft(event.target.value)}
                placeholder="CommandOrControl+Shift+Q"
              />
              <div className="settings__row">
                <button
                  type="button"
                  className="settings__choice"
                  disabled={busy}
                  onClick={() => void saveQuestionCapture({ hotkey: hotkeyDraft })}
                >
                  Save hotkey
                </button>
              </div>
              {hotkeyStatus ? <p className="settings__status">{hotkeyStatus}</p> : null}
            </div>

            <div className="settings__group">
              <h2>Capture Mode</h2>
              <div className="settings__row" role="radiogroup" aria-label="Capture Mode">
                {(
                  [
                    { id: 'region', label: 'Select Region' },
                    { id: 'active_window', label: 'Active Window' },
                    { id: 'full_screen', label: 'Full Screen' },
                  ] as const satisfies ReadonlyArray<{ id: QuestionCaptureMode; label: string }>
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={questionCapture.captureMode === option.id}
                    className={
                      questionCapture.captureMode === option.id
                        ? 'settings__choice settings__choice--active'
                        : 'settings__choice'
                    }
                    disabled={busy || questionCapture.captureMode === option.id}
                    onClick={() => void saveQuestionCapture({ captureMode: option.id })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings__group">
              <h2>Transparency</h2>
              <div className="settings__row">
                <button
                  type="button"
                  className={
                    appearance.transparencyEnabled
                      ? 'settings__choice settings__choice--active'
                      : 'settings__choice'
                  }
                  disabled={busy || appearance.transparencyEnabled}
                  onClick={() => void saveAppearance({ transparencyEnabled: true })}
                >
                  On
                </button>
                <button
                  type="button"
                  className={
                    !appearance.transparencyEnabled
                      ? 'settings__choice settings__choice--active'
                      : 'settings__choice'
                  }
                  disabled={busy || !appearance.transparencyEnabled}
                  onClick={() => void saveAppearance({ transparencyEnabled: false })}
                >
                  Off
                </button>
              </div>
            </div>

            <div className="settings__group">
              <h2>Content Clarity</h2>
              <p className="settings__hint">
                Strengthens the conversation reading surface over bright or busy desktops without
                making the window opaque.
              </p>
              <div className="settings__row" role="radiogroup" aria-label="Content Clarity">
                {(
                  [
                    { id: 'glass', label: 'Glass' },
                    { id: 'balanced', label: 'Balanced' },
                    { id: 'focused', label: 'Focused' },
                  ] as const satisfies ReadonlyArray<{
                    id: AppearanceContentClarity;
                    label: string;
                  }>
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={appearance.contentClarity === option.id}
                    className={
                      appearance.contentClarity === option.id
                        ? 'settings__choice settings__choice--active'
                        : 'settings__choice'
                    }
                    disabled={busy || appearance.contentClarity === option.id}
                    onClick={() => void saveAppearance({ contentClarity: option.id })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings__group">
              <h2>Intensity</h2>
              <div className="settings__row">
                {(['subtle', 'medium', 'strong'] as AppearanceIntensity[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={
                      appearance.intensity === level
                        ? 'settings__choice settings__choice--active'
                        : 'settings__choice'
                    }
                    disabled={busy || appearance.intensity === level}
                    onClick={() => void saveAppearance({ intensity: level })}
                  >
                    {level === 'subtle' ? 'Subtle' : level === 'medium' ? 'Medium' : 'Strong'}
                  </button>
                ))}
              </div>
            </div>

            <div className="settings__group">
              <h2>Backdrop blur</h2>
              <div className="settings__row">
                {(['low', 'medium', 'high'] as AppearanceBlurLevel[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={
                      appearance.blur === level
                        ? 'settings__choice settings__choice--active'
                        : 'settings__choice'
                    }
                    disabled={busy || appearance.blur === level}
                    onClick={() => void saveAppearance({ blur: level })}
                  >
                    {level === 'low' ? 'Low' : level === 'medium' ? 'Medium' : 'High'}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {settingsPane === 'privacy' ? (
          <>
            <h1>Privacy</h1>
            <p className="settings__lede">
              Window capture protection uses Electron&apos;s documented content-protection API only.
            </p>

            <div className="settings__group" aria-labelledby="window-capture-heading">
              <h2 id="window-capture-heading">Window capture protection</h2>
              <p className="settings__status">
                {protectionEnabled ? 'Content protection: On' : 'Content protection: Off'}
              </p>
              <fieldset className="settings__fieldset" disabled={busy}>
                <legend className="settings__legend">Policy</legend>
                <div
                  className="settings__policy-list"
                  role="radiogroup"
                  aria-label="Window Capture Protection"
                >
                  {CAPTURE_POLICY_OPTIONS.map((option) => (
                    <label
                      key={option.id}
                      className={
                        windowPrivacyPolicy === option.id
                          ? 'settings__policy settings__policy--active'
                          : 'settings__policy'
                      }
                    >
                      <input
                        type="radio"
                        name="window-capture-protection"
                        value={option.id}
                        checked={windowPrivacyPolicy === option.id}
                        disabled={busy}
                        onChange={() => void setWindowCaptureProtection(option.id)}
                      />
                      <span className="settings__policy-text">
                        <strong>
                          {option.label} — {option.description}
                        </strong>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </>
        ) : null}

        {settingsPane === 'advanced' ? (
          <>
            <h1>Advanced</h1>
            <p className="settings__lede">
              Developer tools for audio, context, visual capture, and orchestration.
            </p>
            <div className="settings__group">
              <h2>Diagnostics</h2>
              <button type="button" onClick={onOpenDiagnostics}>
                Open Advanced Diagnostics
              </button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
