import { useEffect, useState } from 'react';
import type {
  VisualCaptureSource,
  VisualContextStatus,
  VisualSourceKind,
} from '../../shared/visual-context/types';
import type { VisualIntelligenceStatus } from '../../shared/visual-intelligence/types';
import './visualContextPanel.css';

const SOURCE_OPTIONS: VisualSourceKind[] = ['DISPLAY', 'WINDOW', 'REGION', 'MANUAL_IMAGE'];

export function VisualContextPanel() {
  const [status, setStatus] = useState<VisualContextStatus | null>(null);
  const [intel, setIntel] = useState<VisualIntelligenceStatus | null>(null);
  const [sources, setSources] = useState<VisualCaptureSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [statusResult, sourcesResult, intelResult] = await Promise.all([
      window.companyAI.visual.getStatus(),
      window.companyAI.visual.listSources(),
      window.companyAI.visualIntelligence.getStatus(),
    ]);
    if (statusResult.ok) setStatus(statusResult.data);
    if (sourcesResult.ok) setSources(sourcesResult.data);
    if (intelResult.ok) setIntel(intelResult.data);
  }

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    async function bootstrap() {
      await refresh();
      if (cancelled) return;
    }

    void bootstrap();
    unsubscribers.push(window.companyAI.visual.onStatusChanged(() => void refresh()));
    unsubscribers.push(window.companyAI.visual.onFrameCaptured(() => void refresh()));
    unsubscribers.push(window.companyAI.visual.onContextChanged(() => void refresh()));
    unsubscribers.push(
      window.companyAI.visual.onFrameRejected((event) => {
        setError(event.message ?? 'Frame rejected');
        void refresh();
      }),
    );
    unsubscribers.push(window.companyAI.visualIntelligence.onUpdated(() => void refresh()));
    unsubscribers.push(
      window.companyAI.visualIntelligence.onOcrFailed((event) => {
        setError(event.message ?? 'OCR failed');
        void refresh();
      }),
    );
    unsubscribers.push(
      window.companyAI.visualIntelligence.onVisionFailed((event) => {
        setError(event.message ?? 'Vision failed');
        void refresh();
      }),
    );

    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);

  async function run(action: () => Promise<{ ok: boolean; error?: { message: string } }>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error?.message ?? 'Visual action failed');
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const caps = status?.capabilities;

  return (
    <section className="visual-panel" aria-label="Visual context diagnostics">
      <div className="visual-panel__block">
        <div className="visual-panel__heading">
          <h2>Visual Context</h2>
          <span className={`visual-panel__badge state-${status?.state ?? 'disabled'}`}>
            {status?.state ?? 'disabled'}
          </span>
        </div>

        <p className="visual-panel__hint">
          Capture is explicit — nothing is captured automatically on launch.
        </p>

        {error ? (
          <p className="visual-panel__error" role="alert">
            {error}
          </p>
        ) : null}

        <dl className="visual-panel__meta">
          <div>
            <dt>Status</dt>
            <dd>{status?.state ?? '—'}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{status?.source ?? '—'}</dd>
          </div>
          <div>
            <dt>Frames</dt>
            <dd>{status?.frameCount ?? 0}</dd>
          </div>
          <div>
            <dt>Latest capture</dt>
            <dd>
              {status?.latestCaptureAt
                ? new Date(status.latestCaptureAt).toLocaleTimeString()
                : 'Never'}
            </dd>
          </div>
          <div>
            <dt>Display</dt>
            <dd>{caps?.displayCapture ?? '—'}</dd>
          </div>
          <div>
            <dt>Window</dt>
            <dd>{caps?.windowCapture ?? '—'}</dd>
          </div>
          <div>
            <dt>Region</dt>
            <dd>{caps?.regionCapture ?? '—'}</dd>
          </div>
          <div>
            <dt>Manual image</dt>
            <dd>{caps?.manualImage ?? '—'}</dd>
          </div>
        </dl>

        <label className="visual-panel__field">
          <span>Select source type</span>
          <select
            disabled={busy}
            value={status?.source && status.source !== 'NONE' ? status.source : 'DISPLAY'}
            onChange={(event) => {
              const source = event.target.value as VisualSourceKind;
              void run(() => window.companyAI.visual.setSource(source));
            }}
          >
            {SOURCE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        {sources.length > 0 && status?.source !== 'MANUAL_IMAGE' ? (
          <label className="visual-panel__field">
            <span>Capture target</span>
            <select
              disabled={busy}
              value={status?.selectedSourceId ?? ''}
              onChange={(event) => {
                const sourceId = event.target.value || null;
                void run(() =>
                  window.companyAI.visual.setSource(status?.source ?? 'DISPLAY', sourceId),
                );
              }}
            >
              <option value="">Auto / first available</option>
              {sources
                .filter((item) =>
                  status?.source === 'WINDOW' ? item.kind === 'WINDOW' : item.kind === 'DISPLAY',
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}

        <div className="visual-panel__actions">
          <button type="button" disabled={busy} onClick={() => void run(() => window.companyAI.visual.enable())}>
            Enable
          </button>
          <button type="button" disabled={busy} onClick={() => void run(() => window.companyAI.visual.disable())}>
            Disable
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => window.companyAI.visual.requestPermission())}
          >
            Request permission
          </button>
          <button type="button" disabled={busy} onClick={() => void run(() => window.companyAI.visual.start())}>
            Start
          </button>
          <button type="button" disabled={busy} onClick={() => void run(() => window.companyAI.visual.pause())}>
            Pause
          </button>
          <button type="button" disabled={busy} onClick={() => void run(() => window.companyAI.visual.resume())}>
            Resume
          </button>
          <button type="button" disabled={busy} onClick={() => void run(() => window.companyAI.visual.stop())}>
            Stop
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await window.companyAI.visual.captureNow({
                  sourceKind: status?.source === 'NONE' ? 'DISPLAY' : status?.source,
                  sourceId: status?.selectedSourceId ?? undefined,
                });
                return result;
              })
            }
          >
            Capture Now
          </button>
          <button type="button" disabled={busy} onClick={() => void run(() => window.companyAI.visual.clear())}>
            Clear Context
          </button>
        </div>
      </div>

      <div className="visual-panel__block">
        <div className="visual-panel__heading">
          <h2>Visual Intelligence</h2>
          <span className={`visual-panel__badge state-${intel?.state ?? 'idle'}`}>
            {intel?.state ?? 'idle'}
          </span>
        </div>
        <p className="visual-panel__hint">
          OCR and vision analysis run in the main process. Credentials never reach the renderer.
        </p>
        <dl className="visual-panel__meta">
          <div>
            <dt>OCR</dt>
            <dd>{intel?.ocrEnabled ? 'Enabled' : 'Disabled'}</dd>
          </div>
          <div>
            <dt>OCR provider</dt>
            <dd>{intel?.ocrProvider ?? '—'}</dd>
          </div>
          <div>
            <dt>OCR status</dt>
            <dd>{intel?.ocrAvailable ?? '—'}</dd>
          </div>
          <div>
            <dt>OCR results</dt>
            <dd>{intel?.ocrResultCount ?? 0}</dd>
          </div>
          <div>
            <dt>Vision</dt>
            <dd>{intel?.visionEnabled ? 'Enabled' : 'Disabled'}</dd>
          </div>
          <div>
            <dt>Vision provider</dt>
            <dd>{intel?.visionProvider ?? '—'}</dd>
          </div>
          <div>
            <dt>Vision status</dt>
            <dd>{intel?.visionAvailable ?? '—'}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{intel?.model ?? '—'}</dd>
          </div>
          <div>
            <dt>Vision analyses</dt>
            <dd>{intel?.visionAnalysisCount ?? 0}</dd>
          </div>
          <div>
            <dt>Last latency</dt>
            <dd>{intel?.lastProcessingTimeMs != null ? `${intel.lastProcessingTimeMs} ms` : '—'}</dd>
          </div>
          <div>
            <dt>Last error</dt>
            <dd>{intel?.lastErrorCode ?? '—'}</dd>
          </div>
        </dl>
        <div className="visual-panel__actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => window.companyAI.visualIntelligence.analyzeCurrent(true))}
          >
            Analyze current frame
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => window.companyAI.visualIntelligence.cancel())}
          >
            Cancel analysis
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => window.companyAI.visualIntelligence.clearResults())}
          >
            Clear results
          </button>
        </div>
      </div>
    </section>
  );
}
