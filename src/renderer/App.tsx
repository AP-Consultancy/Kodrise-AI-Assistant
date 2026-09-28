import { useEffect, useState, type ReactNode } from 'react';
import type { InterviewStatus } from '../shared/interview/types';
import type { AppearancePublicConfig } from '../shared/config/types';
import { DEFAULT_APPEARANCE_PUBLIC_CONFIG } from '../shared/config/types';
import { ProductShell } from './components/ProductShell';
import { PrepareSessionPage } from './components/PrepareSessionPage';
import { LiveInterviewPage } from './components/LiveInterviewPage';
import { SessionSummaryPage } from './components/SessionSummaryPage';
import { SettingsPage } from './components/SettingsPage';
import { DiagnosticsPage } from './components/DiagnosticsPage';
import { TitleBar } from './components/TitleBar';
import {
  resolveProductView,
  type ShellDestination,
} from './navigation/productNavigation';

function applyAppearance(appearance: AppearancePublicConfig): void {
  const root = document.documentElement;
  root.dataset.transparency = appearance.transparencyEnabled ? 'on' : 'off';
  root.dataset.intensity = appearance.intensity;
  root.dataset.blur = appearance.blur;
  root.dataset.clarity = appearance.contentClarity ?? 'balanced';
}

export function App() {
  const [destination, setDestination] = useState<ShellDestination>('session');
  const [status, setStatus] = useState<InterviewStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.companyAI.interview.getStatus().then((result) => {
      if (!cancelled && result.ok) setStatus(result.data);
    });
    const unsubscribe = window.companyAI.interview.onStatusChanged((next) => {
      setStatus(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    applyAppearance(DEFAULT_APPEARANCE_PUBLIC_CONFIG);
    void window.companyAI.config.getPublic().then((result) => {
      if (!cancelled && result.ok) {
        applyAppearance(result.data.appearance ?? DEFAULT_APPEARANCE_PUBLIC_CONFIG);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const phase = status?.phase ?? 'prepare';
  const live = phase === 'live';
  const view = resolveProductView({
    destination,
    phase,
    hasSummary: Boolean(status?.summary),
  });

  function navigate(next: ShellDestination) {
    setDestination(next);
  }

  const modeLabel =
    live && status?.executionMode === 'simulation'
      ? 'Java simulation'
      : live
        ? 'Live interview'
        : view === 'summary'
          ? 'Summary'
          : view === 'settings' || view === 'diagnostics'
            ? 'Settings'
            : 'Prepare';

  let content: ReactNode;
  switch (view) {
    case 'settings':
      content = (
        <SettingsPage
          onOpenDiagnostics={() => setDestination('diagnostics')}
          onAppearanceChanged={applyAppearance}
        />
      );
      break;
    case 'diagnostics':
      content = <DiagnosticsPage onBack={() => setDestination('settings')} />;
      break;
    case 'live':
      content = status ? (
        <LiveInterviewPage
          status={status}
          onEnded={() => {
            setDestination('session');
          }}
        />
      ) : (
        <PrepareSessionPage onStarted={() => setDestination('session')} />
      );
      break;
    case 'summary':
      content =
        status?.summary != null ? (
          <SessionSummaryPage
            summary={status.summary}
            onNewInterview={() => {
              void window.companyAI.interview.newInterview().then((result) => {
                if (result.ok) {
                  setStatus(result.data);
                  setDestination('session');
                }
              });
            }}
          />
        ) : (
          <PrepareSessionPage onStarted={() => setDestination('session')} />
        );
      break;
    case 'prepare':
    default:
      content = (
        <PrepareSessionPage
          onStarted={() => {
            setDestination('session');
          }}
        />
      );
      break;
  }

  return (
    <div className="app-frame">
      <div className="app-shell">
        <div className="app-atmosphere" aria-hidden="true" />
        <TitleBar />
        <div className="app-content">
          <ProductShell
            destination={destination}
            onNavigate={navigate}
            live={live && destination === 'session'}
            paused={Boolean(status?.paused)}
            modeLabel={modeLabel}
            startedAt={status?.startedAt ?? null}
          >
            {content}
          </ProductShell>
        </div>
      </div>
    </div>
  );
}
