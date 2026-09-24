import { useEffect, useState } from 'react';
import type { ContextEngineStatus, ContextSnapshot } from '../../shared/context/types';
import './contextPanel.css';

export function ContextEnginePanel() {
  const [status, setStatus] = useState<ContextEngineStatus | null>(null);
  const [current, setCurrent] = useState<ContextSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    async function bootstrap() {
      const [statusResult, currentResult] = await Promise.all([
        window.companyAI.context.getStatus(),
        window.companyAI.context.getCurrent(),
      ]);
      if (cancelled) {
        return;
      }
      if (statusResult.ok) setStatus(statusResult.data);
      if (currentResult.ok) setCurrent(currentResult.data);
    }

    void bootstrap();

    unsubscribers.push(
      window.companyAI.context.onCreated(async () => {
        const [statusResult, currentResult] = await Promise.all([
          window.companyAI.context.getStatus(),
          window.companyAI.context.getCurrent(),
        ]);
        if (statusResult.ok) setStatus(statusResult.data);
        if (currentResult.ok) setCurrent(currentResult.data);
      }),
    );
    unsubscribers.push(
      window.companyAI.context.onTruncated(async () => {
        const currentResult = await window.companyAI.context.getCurrent();
        if (currentResult.ok) setCurrent(currentResult.data);
      }),
    );

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  async function handleClear() {
    const result = await window.companyAI.context.clear();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setStatus(result.data);
    setCurrent(null);
  }

  return (
    <section className="context-panel" aria-label="Context engine diagnostics">
      <div className="context-panel__block">
        <div className="context-panel__heading">
          <h2>Context Engine</h2>
          <span className={`context-panel__badge ${status?.enabled ? 'is-ready' : 'is-idle'}`}>
            {status?.enabled ? 'Ready' : 'Paused'}
          </span>
        </div>

        {error ? (
          <p className="context-panel__error" role="alert">
            {error}
          </p>
        ) : null}

        <dl className="context-panel__meta">
          <div>
            <dt>User context</dt>
            <dd>{status?.userContextConfigured ? 'Configured' : 'Not set'}</dd>
          </div>
          <div>
            <dt>Project context</dt>
            <dd>{status?.projectContextConfigured ? 'Configured' : 'Not set'}</dd>
          </div>
          <div>
            <dt>Snapshots</dt>
            <dd>{status?.snapshotCount ?? 0}</dd>
          </div>
        </dl>

        {current ? (
          <div className="context-panel__current">
            <h3>Current question</h3>
            <p>{current.currentQuestion.text}</p>

            {current.relatedQuestions[0] ? (
              <>
                <h3>Related question</h3>
                <p>{current.relatedQuestions[0].text}</p>
              </>
            ) : null}

            <h3>Recent transcript</h3>
            {current.recentTranscript.length === 0 ? (
              <p className="context-panel__empty">No transcript window</p>
            ) : (
              <ul>
                {current.recentTranscript.slice(-4).map((segment) => (
                  <li key={segment.id}>{segment.text}</li>
                ))}
              </ul>
            )}

            <dl className="context-panel__meta">
              <div>
                <dt>Context size</dt>
                <dd>{current.metadata.characterCount.toLocaleString()} characters</dd>
              </div>
              <div>
                <dt>Truncated</dt>
                <dd>{current.metadata.truncated ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt>Completeness</dt>
                <dd>{Math.round(current.quality.completeness * 100)}%</dd>
              </div>
            </dl>
          </div>
        ) : (
          <p className="context-panel__empty">
            No context snapshot yet. Detect a question to build context.
          </p>
        )}

        <div className="context-panel__actions">
          <button type="button" onClick={() => void handleClear()}>
            Clear context
          </button>
        </div>
      </div>
    </section>
  );
}
