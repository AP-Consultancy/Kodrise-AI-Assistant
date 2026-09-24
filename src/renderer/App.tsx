import { useEffect, useState, type ReactNode } from 'react';
import type { InterviewStatus } from '../shared/interview/types';
import { ProductShell } from './components/ProductShell';
import { PrepareSessionPage } from './components/PrepareSessionPage';
import { LiveInterviewPage } from './components/LiveInterviewPage';
import { SessionSummaryPage } from './components/SessionSummaryPage';
import { SettingsPage } from './components/SettingsPage';
import { DiagnosticsPage } from './components/DiagnosticsPage';
import {
  resolveProductView,
  type ShellDestination,
} from './navigation/productNavigation';

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

  let content: ReactNode;
  switch (view) {
    case 'settings':
      content = <SettingsPage onOpenDiagnostics={() => setDestination('diagnostics')} />;
      break;
    case 'diagnostics':
      content = <DiagnosticsPage onBack={() => setDestination('settings')} />;
      break;
    case 'live':
      content = status ? (
        <LiveInterviewPage
          status={status}
          onEnded={() => {
            // InterviewHost phase → summary; stay on session destination.
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
            // Start Interview → InterviewHost phase becomes live; no Interview tab click.
            setDestination('session');
          }}
        />
      );
      break;
  }

  return (
    <ProductShell destination={destination} onNavigate={navigate} live={live}>
      {content}
    </ProductShell>
  );
}
