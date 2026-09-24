import { useEffect, useState } from 'react';
import type {
  CaptureCapabilities,
  CaptureHarnessSnapshot,
  CapturePolicyApplyResult,
  CapturePolicyId,
  CapturePolicyStatus,
} from '../../shared/capture-policy/types';
import './capturePrivacyPanel.css';

const POLICIES: CapturePolicyId[] = ['STANDARD', 'PRIVACY_AWARE', 'DISABLED'];

export function CapturePrivacyPanel() {
  const [status, setStatus] = useState<CapturePolicyStatus | null>(null);
  const [capabilities, setCapabilities] = useState<CaptureCapabilities | null>(null);
  const [harness, setHarness] = useState<CaptureHarnessSnapshot | null>(null);
  const [lastResult, setLastResult] = useState<CapturePolicyApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [statusResult, capsResult] = await Promise.all([
      window.companyAI.capture.getStatus(),
      window.companyAI.capture.getCapabilities(),
    ]);
    if (statusResult.ok) setStatus(statusResult.data);
    if (capsResult.ok) setCapabilities(capsResult.data);
  }

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    async function bootstrap() {
      const [statusResult, capsResult] = await Promise.all([
        window.companyAI.capture.getStatus(),
        window.companyAI.capture.getCapabilities(),
      ]);
      if (cancelled) return;
      if (statusResult.ok) setStatus(statusResult.data);
      if (capsResult.ok) setCapabilities(capsResult.data);
    }

    void bootstrap();

    unsubscribers.push(
      window.companyAI.capture.onPolicyChanged(() => {
        void refresh();
      }),
    );
    unsubscribers.push(
      window.companyAI.capture.onDiagnosticUpdated(() => {
        void refresh();
      }),
    );
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, []);

  async function handleApply(policy: CapturePolicyId) {
    setBusy(true);
    setError(null);
    try {
      const result = await window.companyAI.capture.applyPolicy(policy);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setLastResult(result.data);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    setError(null);
    try {
      const result = await window.companyAI.capture.resetPolicy();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setLastResult(result.data);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleHarness() {
    setBusy(true);
    setError(null);
    try {
      const result = await window.companyAI.capture.getHarness();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setHarness(result.data);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="capture-privacy-panel" aria-label="Capture privacy diagnostics">
      <div className="capture-privacy-panel__block">
        <div className="capture-privacy-panel__heading">
          <h2>Capture Privacy</h2>
          <span
            className={`capture-privacy-panel__badge status-${(status?.overallStatus ?? 'UNKNOWN').toLowerCase()}`}
          >
            {status?.overallStatus ?? '—'}
          </span>
        </div>

        {error ? (
          <p className="capture-privacy-panel__error" role="alert">
            {error}
          </p>
        ) : null}

        <dl className="capture-privacy-panel__meta">
          <div>
            <dt>Platform</dt>
            <dd>{status?.platform ?? '—'}</dd>
          </div>
          <div>
            <dt>Electron</dt>
            <dd>{status?.electronVersion ?? '—'}</dd>
          </div>
          <div>
            <dt>Policy</dt>
            <dd>{status?.policy ?? '—'}</dd>
          </div>
          <div>
            <dt>Content protection</dt>
            <dd>{status?.contentProtectionEnabled ? 'Enabled' : 'Off'}</dd>
          </div>
          <div>
            <dt>Window capture protection</dt>
            <dd>{capabilities?.windowCaptureProtection ?? '—'}</dd>
          </div>
          <div>
            <dt>Display capture protection</dt>
            <dd>{capabilities?.displayCaptureProtection ?? '—'}</dd>
          </div>
          <div>
            <dt>App capture protection</dt>
            <dd>{capabilities?.applicationCaptureProtection ?? '—'}</dd>
          </div>
          <div>
            <dt>Local recording protection</dt>
            <dd>{capabilities?.localRecordingProtection ?? '—'}</dd>
          </div>
          <div>
            <dt>Electron API</dt>
            <dd>{capabilities?.electronCapabilityAvailable ?? '—'}</dd>
          </div>
          <div>
            <dt>OS permission</dt>
            <dd>
              {capabilities?.requiresAdditionalPermission ? 'Required' : 'Not required'}
            </dd>
          </div>
          <div>
            <dt>Linux display</dt>
            <dd>{capabilities?.linuxDisplayServer ?? '—'}</dd>
          </div>
        </dl>

        <div className="capture-privacy-panel__actions">
          {POLICIES.map((policy) => (
            <button
              key={policy}
              type="button"
              disabled={busy}
              onClick={() => void handleApply(policy)}
            >
              {policy}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => void handleReset()}>
            Reset
          </button>
          <button type="button" disabled={busy} onClick={() => void handleHarness()}>
            Dev harness
          </button>
        </div>

        {lastResult ? (
          <p className="capture-privacy-panel__result">
            Last apply: {lastResult.success ? 'ok' : 'failed'} — {lastResult.message} (
            {lastResult.status})
          </p>
        ) : null}

        <div className="capture-privacy-panel__limitations">
          <h3>Limitations</h3>
          <ul>
            {(status?.limitations ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        {status?.diagnostics?.length ? (
          <div className="capture-privacy-panel__diagnostics">
            <h3>Recent diagnostics</h3>
            <ul>
              {status.diagnostics.slice(-6).map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.level}</strong> [{entry.code}] {entry.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {harness ? (
          <div className="capture-privacy-panel__harness">
            <h3>Dev harness</h3>
            <p className="capture-privacy-panel__warning">{harness.warning}</p>
            <dl className="capture-privacy-panel__meta">
              <div>
                <dt>Windows</dt>
                <dd>{harness.windowCount}</dd>
              </div>
              <div>
                <dt>Focused id</dt>
                <dd>{harness.focusedWindowId ?? '—'}</dd>
              </div>
              <div>
                <dt>OS</dt>
                <dd>{harness.osRelease}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>
    </section>
  );
}
