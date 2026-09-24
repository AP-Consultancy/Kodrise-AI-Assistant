import type { InterviewSummary } from '../../shared/interview/types';
import './sessionSummary.css';

interface SessionSummaryPageProps {
  summary: InterviewSummary;
  onNewInterview: () => void;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  if (totalMinutes < 1) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return `${seconds} seconds`;
  }
  return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
}

export function SessionSummaryPage({ summary, onNewInterview }: SessionSummaryPageProps) {
  return (
    <section className="summary" aria-labelledby="summary-title">
      <h1 id="summary-title">Interview Complete</h1>
      <dl className="summary__stats">
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(summary.durationMs)}</dd>
        </div>
        <div>
          <dt>Questions</dt>
          <dd>{summary.questionCount}</dd>
        </div>
        <div>
          <dt>Answers generated</dt>
          <dd>{summary.answersGenerated}</dd>
        </div>
        <div>
          <dt>Visual analyses</dt>
          <dd>{summary.visualAnalyses}</dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd>{summary.errorCount}</dd>
        </div>
      </dl>
      <button type="button" className="summary__primary" onClick={onNewInterview}>
        New Interview
      </button>
    </section>
  );
}
