import type {
  FoundationCheckItem,
  FoundationDiagnostics,
  SessionSnapshot,
} from '@shared/ipc/types';
import './foundationStatus.css';

interface FoundationStatusProps {
  loading: boolean;
  error: string | null;
  ipcConnected: boolean;
  checks: FoundationCheckItem[];
  diagnostics: FoundationDiagnostics | null;
  session: SessionSnapshot | null;
  onVerifyIpc: () => void;
  onRefresh: () => void;
  onStartSession: () => void;
  onStopSession: () => void;
  onPauseSession: () => void;
  onResumeSession: () => void;
  onToggleTheme: () => void;
}

export function FoundationStatus({
  loading,
  error,
  ipcConnected,
  checks,
  diagnostics,
  session,
  onVerifyIpc,
  onRefresh,
  onStartSession,
  onStopSession,
  onPauseSession,
  onResumeSession,
  onToggleTheme,
}: FoundationStatusProps) {
  const runtime = diagnostics?.runtime;

  return (
    <section className="foundation">
      <div className="foundation__panel">
        <div className="foundation__heading">
          <h2>Foundation Status</h2>
          <span className={`foundation__ipc ${ipcConnected ? 'is-connected' : 'is-pending'}`}>
            IPC: {ipcConnected ? 'CONNECTED' : 'PENDING'}
          </span>
        </div>

        <ul className="foundation__list">
          {checks.map((check) => (
            <li key={check.id} className={`foundation__item foundation__item--${check.status}`}>
              <span className="foundation__status">{statusLabel(check.status)}</span>
              <div>
                <strong>{check.label}</strong>
                <p>{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="foundation__actions">
          <button type="button" onClick={onVerifyIpc} disabled={loading}>
            Verify IPC
          </button>
          <button type="button" onClick={onRefresh} disabled={loading}>
            Refresh diagnostics
          </button>
          <button type="button" onClick={onStartSession} disabled={loading}>
            Start session
          </button>
          <button type="button" onClick={onPauseSession} disabled={loading}>
            Pause
          </button>
          <button type="button" onClick={onResumeSession} disabled={loading}>
            Resume
          </button>
          <button type="button" onClick={onStopSession} disabled={loading}>
            Stop session
          </button>
          <button type="button" onClick={onToggleTheme} disabled={loading || !diagnostics}>
            Toggle theme pref
          </button>
        </div>

        {loading && <p className="foundation__note">Loading foundation diagnostics…</p>}
        {error && <p className="foundation__error">{error}</p>}
      </div>

      <div className="foundation__side">
        <div className="foundation__panel">
          <h2>Runtime</h2>
          {runtime ? (
            <dl className="foundation__meta">
              <div>
                <dt>Application</dt>
                <dd>{runtime.version}</dd>
              </div>
              <div>
                <dt>Electron</dt>
                <dd>{runtime.electron}</dd>
              </div>
              <div>
                <dt>Platform</dt>
                <dd>
                  {runtime.platform}/{runtime.arch}
                </dd>
              </div>
              <div>
                <dt>Packaged</dt>
                <dd>{String(runtime.isPackaged)}</dd>
              </div>
              <div>
                <dt>Sandbox</dt>
                <dd>{String(runtime.sandbox)}</dd>
              </div>
              <div>
                <dt>Credential storage</dt>
                <dd>{diagnostics?.credentialStorage ?? '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="foundation__note">Runtime details unavailable until IPC succeeds.</p>
          )}
        </div>

        <div className="foundation__panel">
          <h2>Session</h2>
          {session ? (
            <dl className="foundation__meta">
              <div>
                <dt>State</dt>
                <dd>{session.state}</dd>
              </div>
              <div>
                <dt>Session ID</dt>
                <dd>{session.sessionId ?? '—'}</dd>
              </div>
              <div>
                <dt>Correlation ID</dt>
                <dd>{session.correlationId ?? '—'}</dd>
              </div>
            </dl>
          ) : (
            <p className="foundation__note">No session snapshot yet.</p>
          )}
        </div>

        <div className="foundation__panel">
          <h2>Public configuration</h2>
          {diagnostics ? (
            <pre className="foundation__pre">{JSON.stringify(diagnostics.publicConfig, null, 2)}</pre>
          ) : (
            <p className="foundation__note">Configuration not loaded.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function statusLabel(status: FoundationCheckItem['status']): string {
  switch (status) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'ready':
      return 'READY';
    case 'not_configured':
      return 'N/A';
    case 'not_tested':
      return 'UNTESTED';
    case 'unavailable':
      return 'UNAVAIL';
    default:
      return 'PENDING';
  }
}
