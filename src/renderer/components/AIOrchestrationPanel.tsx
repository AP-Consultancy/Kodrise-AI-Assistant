import { useEffect, useState } from 'react';
import type {
  AIConfigStatus,
  AIOrchestratorStatus,
  AIResponseState,
} from '../../shared/ai/types';
import { AI_OPENAI_CREDENTIAL_KEY } from '../../shared/ai/types';
import type { DetectedQuestion } from '../../shared/questions/types';
import './aiPanel.css';

export function AIOrchestrationPanel() {
  const [status, setStatus] = useState<AIOrchestratorStatus | null>(null);
  const [config, setConfig] = useState<AIConfigStatus | null>(null);
  const [response, setResponse] = useState<AIResponseState | null>(null);
  const [question, setQuestion] = useState<DetectedQuestion | null>(null);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState('');

  async function refreshAiConfig() {
    const [statusResult, configResult] = await Promise.all([
      window.companyAI.ai.getStatus(),
      window.companyAI.ai.getConfiguration(),
    ]);
    if (statusResult.ok) setStatus(statusResult.data);
    if (configResult.ok) setConfig(configResult.data);
  }

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    async function refresh() {
      const [statusResult, configResult, responseResult, questionResult] = await Promise.all([
        window.companyAI.ai.getStatus(),
        window.companyAI.ai.getConfiguration(),
        window.companyAI.ai.getCurrentResponse(),
        window.companyAI.questions.getCurrent(),
      ]);
      if (cancelled) return;
      if (statusResult.ok) setStatus(statusResult.data);
      if (configResult.ok) setConfig(configResult.data);
      if (responseResult.ok) {
        setResponse(responseResult.data);
        setStreamText(responseResult.data?.text ?? '');
      }
      if (questionResult.ok) setQuestion(questionResult.data);
    }

    void refresh();

    unsubscribers.push(
      window.companyAI.questions.onClassified(async () => {
        const result = await window.companyAI.questions.getCurrent();
        if (result.ok) setQuestion(result.data);
      }),
    );
    unsubscribers.push(
      window.companyAI.ai.onResponseStarted(async () => {
        setBusy(true);
        setStreamText('');
        setError(null);
        const statusResult = await window.companyAI.ai.getStatus();
        if (statusResult.ok) setStatus(statusResult.data);
      }),
    );
    unsubscribers.push(
      window.companyAI.ai.onResponseChunk((event) => {
        if (event.textDelta) {
          setStreamText((prev) => prev + event.textDelta);
        }
      }),
    );
    unsubscribers.push(
      window.companyAI.ai.onResponseCompleted(async () => {
        setBusy(false);
        const [statusResult, responseResult] = await Promise.all([
          window.companyAI.ai.getStatus(),
          window.companyAI.ai.getCurrentResponse(),
        ]);
        if (statusResult.ok) setStatus(statusResult.data);
        if (responseResult.ok) {
          setResponse(responseResult.data);
          setStreamText(responseResult.data?.text ?? '');
        }
      }),
    );
    unsubscribers.push(
      window.companyAI.ai.onResponseCancelled(async () => {
        setBusy(false);
        const result = await window.companyAI.ai.getCurrentResponse();
        if (result.ok) {
          setResponse(result.data);
          setStreamText(result.data?.text ?? '');
        }
      }),
    );
    unsubscribers.push(
      window.companyAI.ai.onResponseError(async (event) => {
        setBusy(false);
        setError(event.error?.message ?? 'AI response failed');
        const result = await window.companyAI.ai.getCurrentResponse();
        if (result.ok) setResponse(result.data);
      }),
    );

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  async function handleSaveApiKey() {
    setBusy(true);
    setError(null);
    try {
      const value = apiKeyDraft.trim();
      if (!value) {
        setError('Enter an OpenAI API key');
        return;
      }
      const result = await window.companyAI.credentials.set(AI_OPENAI_CREDENTIAL_KEY, value);
      setApiKeyDraft('');
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await refreshAiConfig();
    } finally {
      setBusy(false);
    }
  }

  async function handleClearApiKey() {
    setBusy(true);
    setError(null);
    try {
      const result = await window.companyAI.credentials.delete(AI_OPENAI_CREDENTIAL_KEY);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setApiKeyDraft('');
      await refreshAiConfig();
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerate() {
    if (!question) {
      setError('No classified question available');
      return;
    }
    if (config && !config.configured && config.provider !== 'mock') {
      setError('Configure the OpenAI API key before generating');
      return;
    }
    setError(null);
    setBusy(true);
    setStreamText('');
    const result = await window.companyAI.ai.generate(question.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setResponse(result.data);
    setStreamText(result.data.text);
    const statusResult = await window.companyAI.ai.getStatus();
    if (statusResult.ok) setStatus(statusResult.data);
  }

  async function handleCancel() {
    const result = await window.companyAI.ai.cancel(status?.activeRequestId ?? undefined);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setResponse(result.data);
    setStreamText(result.data?.text ?? '');
  }

  async function handleClear() {
    const result = await window.companyAI.ai.clearResponse();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setStatus(result.data);
    setResponse(null);
    setStreamText('');
  }

  return (
    <section className="ai-panel" aria-label="AI orchestration diagnostics">
      <div className="ai-panel__block">
        <div className="ai-panel__heading">
          <h2>AI Orchestration</h2>
          <span
            className={`ai-panel__badge ${
              status?.responseStatus === 'generating' ? 'is-live' : status?.configured ? 'is-ready' : 'is-idle'
            }`}
          >
            {status?.responseStatus === 'generating'
              ? 'Streaming'
              : status?.configured
                ? 'Ready'
                : 'Not configured'}
          </span>
        </div>

        {error ? (
          <p className="ai-panel__error" role="alert">
            {error}
          </p>
        ) : null}

        <dl className="ai-panel__meta">
          <div>
            <dt>Provider</dt>
            <dd>{config?.provider ?? '—'}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{config?.model ?? '—'}</dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{config?.responseMode ?? '—'}</dd>
          </div>
          <div>
            <dt>Auto-generate</dt>
            <dd>{config?.autoGenerate ? 'On' : 'Off'}</dd>
          </div>
          <div>
            <dt>Credentials</dt>
            <dd>{config?.configured ? 'Configured' : 'Missing'}</dd>
          </div>
          <div>
            <dt>Vault key</dt>
            <dd>
              <code>{AI_OPENAI_CREDENTIAL_KEY}</code>
            </dd>
          </div>
          <div>
            <dt>Latency</dt>
            <dd>
              {response?.metadata.latencyMs != null ? `${response.metadata.latencyMs} ms` : '—'}
            </dd>
          </div>
          <div>
            <dt>TTFT</dt>
            <dd>
              {response?.metadata.timeToFirstTokenMs != null
                ? `${response.metadata.timeToFirstTokenMs} ms`
                : '—'}
            </dd>
          </div>
        </dl>

        <div className="ai-panel__credential">
          <label className="ai-panel__field">
            <span>OpenAI API key (stored in vault — never shown again)</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKeyDraft}
              onChange={(event) => setApiKeyDraft(event.target.value)}
              placeholder={config?.configured ? '•••••••• (replace)' : 'Enter API key'}
              disabled={busy}
            />
          </label>
          <div className="ai-panel__actions">
            <button type="button" onClick={() => void handleSaveApiKey()} disabled={busy}>
              Save key
            </button>
            <button type="button" onClick={() => void handleClearApiKey()} disabled={busy}>
              Clear key
            </button>
          </div>
        </div>

        <div className="ai-panel__question">
          <h3>Current question</h3>
          <p>{question?.text ?? 'No classified question yet.'}</p>
        </div>

        <div className="ai-panel__actions">
          <button type="button" onClick={() => void handleGenerate()} disabled={busy || !question}>
            Generate Answer
          </button>
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={!busy && !status?.activeRequestId}
          >
            Cancel
          </button>
          <button type="button" onClick={() => void handleClear()}>
            Clear
          </button>
        </div>

        <div className="ai-panel__response">
          <h3>Response</h3>
          <pre>{streamText || response?.text || 'No response yet.'}</pre>
          <p className="ai-panel__status">
            Status: {response?.status ?? status?.responseStatus ?? 'idle'}
          </p>
        </div>
      </div>
    </section>
  );
}
