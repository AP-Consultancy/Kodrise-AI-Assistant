import { FoundationStatus } from './FoundationStatus';
import { AudioTranscriptPanel } from './AudioTranscriptPanel';
import { QuestionUnderstandingPanel } from './QuestionUnderstandingPanel';
import { ContextEnginePanel } from './ContextEnginePanel';
import { AIOrchestrationPanel } from './AIOrchestrationPanel';
import { CapturePrivacyPanel } from './CapturePrivacyPanel';
import { VisualContextPanel } from './VisualContextPanel';
import { useFoundationChecks } from '../hooks/useFoundationChecks';
import './diagnosticsPage.css';

interface DiagnosticsPageProps {
  onBack: () => void;
}

export function DiagnosticsPage({ onBack }: DiagnosticsPageProps) {
  const state = useFoundationChecks();

  return (
    <section className="diagnostics" aria-labelledby="diagnostics-title">
      <div className="diagnostics__head">
        <div>
          <h1 id="diagnostics-title">Advanced Diagnostics</h1>
          <p>Engineering controls from earlier phases. Not part of the normal interview flow.</p>
        </div>
        <button type="button" onClick={onBack}>
          Back to Settings
        </button>
      </div>
      <FoundationStatus
        loading={state.loading}
        error={state.error}
        ipcConnected={state.ipcConnected}
        checks={state.checks}
        diagnostics={state.diagnostics}
        session={state.session}
        onVerifyIpc={() => {
          void state.verifyIpc();
        }}
        onRefresh={() => {
          void state.refresh();
        }}
        onStartSession={() => {
          void state.startSession();
        }}
        onStopSession={() => {
          void state.stopSession();
        }}
        onPauseSession={() => {
          void state.pauseSession();
        }}
        onResumeSession={() => {
          void state.resumeSession();
        }}
        onToggleTheme={() => {
          void state.toggleTheme();
        }}
      />
      <AudioTranscriptPanel />
      <QuestionUnderstandingPanel />
      <ContextEnginePanel />
      <AIOrchestrationPanel />
      <CapturePrivacyPanel />
      <VisualContextPanel />
    </section>
  );
}
