import type { InterviewSummary } from '../../shared/interview/types';
import './sessionSummary.css';

interface SessionSummaryPageProps {
  summary: InterviewSummary;
  onNewInterview: () => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function SessionSummaryPage({ summary, onNewInterview }: SessionSummaryPageProps) {
  return (
    <section className="summary" aria-labelledby="summary-title">
      <h1 id="summary-title">Interview complete.</h1>
      <p className="summary__lede">A quiet snapshot of this session.</p>

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
          <dt>Answers</dt>
          <dd>{summary.answersGenerated}</dd>
        </div>
      </dl>

      <div className="summary__actions">
        <button type="button" className="summary__primary" onClick={onNewInterview}>
          Start new interview
        </button>
      </div>
    </section>
  );
}
