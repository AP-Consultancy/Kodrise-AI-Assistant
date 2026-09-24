import { useEffect, useState } from 'react';
import { AI_OPENAI_CREDENTIAL_KEY } from '../../shared/ai/types';
import type { AIProviderId } from '../../shared/ai/types';
import { STT_DEEPGRAM_CREDENTIAL_KEY } from '../../shared/config/types';
import './settingsPage.css';

interface SettingsPageProps {
  onOpenDiagnostics: () => void;
}

export function SettingsPage({ onOpenDiagnostics }: SettingsPageProps) {
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [sttConfigured, setSttConfigured] = useState(false);
  const [openaiKey, setOpenaiKey] = useState('');
  const [sttKey, setSttKey] = useState('');
  const [aiProvider, setAiProvider] = useState<AIProviderId>('openai');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [ai, stt, config] = await Promise.all([
      window.companyAI.credentials.has(AI_OPENAI_CREDENTIAL_KEY),
      window.companyAI.credentials.has(STT_DEEPGRAM_CREDENTIAL_KEY),
      window.companyAI.config.getPublic(),
    ]);
    if (ai.ok) setOpenaiConfigured(ai.data.configured);
    if (stt.ok) setSttConfigured(stt.data.configured);
    if (config.ok) setAiProvider(config.data.ai.provider);
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        if (cancelled) return;
        await refresh();
      })();
    });
    return () => {
      cancelled = true;
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
      if (key === STT_DEEPGRAM_CREDENTIAL_KEY) setSttKey('');
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
      const result = await window.companyAI.config.update({
        ai: { provider },
      } as Parameters<typeof window.companyAI.config.update>[0]);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setAiProvider(result.data.ai.provider);
      setMessage(
        provider === 'mock'
          ? 'Mock AI enabled — answers work offline without OpenAI credits.'
          : 'OpenAI enabled — requires a working API key and quota.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings" aria-labelledby="settings-title">
      <h1 id="settings-title">Settings</h1>
      <p className="settings__lede">Configure providers securely. Secrets never appear after saving.</p>

      {error ? (
        <p className="settings__error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="settings__ok">{message}</p> : null}

      <div className="settings__card">
        <h2>Answer engine</h2>
        <p className="settings__status">
          {aiProvider === 'mock' ? 'Mock AI (offline) ✓' : 'OpenAI'}
        </p>
        <p className="settings__lede">
          No OpenAI credits? Use Mock AI to test the full interview flow. Answers are
          deterministic placeholders — not real model output.
        </p>
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
            Use Mock AI
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
            Use OpenAI
          </button>
        </div>
      </div>

      <div className="settings__card">
        <h2>OpenAI</h2>
        <p className="settings__status">
          {openaiConfigured ? 'Configured ✓' : 'Not configured'}
        </p>
        <label htmlFor="openai-key">API key</label>
        <input
          id="openai-key"
          type="password"
          autoComplete="off"
          value={openaiKey}
          onChange={(event) => setOpenaiKey(event.target.value)}
          placeholder="Paste key — it will not be shown again"
          disabled={busy}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void saveKey(AI_OPENAI_CREDENTIAL_KEY, openaiKey, 'OpenAI')}
        >
          Save OpenAI key
        </button>
      </div>

      <div className="settings__card">
        <h2>Speech (Deepgram)</h2>
        <p className="settings__status">{sttConfigured ? 'Configured ✓' : 'Not configured'}</p>
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

      <div className="settings__card">
        <h2>Advanced Diagnostics</h2>
        <p className="settings__lede">
          Developer tools for audio, context, visual capture, and orchestration. Not needed for a
          normal interview.
        </p>
        <button type="button" onClick={onOpenDiagnostics}>
          Open Advanced Diagnostics
        </button>
      </div>
    </section>
  );
}
