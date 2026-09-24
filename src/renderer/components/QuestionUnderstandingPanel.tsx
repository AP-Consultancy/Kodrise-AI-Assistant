import { useEffect, useState } from 'react';
import type { DetectedQuestion, QuestionPipelineStatus } from '../../shared/questions/types';
import './questionPanel.css';

function formatType(type: string): string {
  return type.replace(/_/g, ' ');
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function QuestionUnderstandingPanel() {
  const [status, setStatus] = useState<QuestionPipelineStatus | null>(null);
  const [current, setCurrent] = useState<DetectedQuestion | null>(null);
  const [recent, setRecent] = useState<DetectedQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];

    async function bootstrap() {
      try {
        const [statusResult, currentResult, recentResult] = await Promise.all([
          window.companyAI.questions.getStatus(),
          window.companyAI.questions.getCurrent(),
          window.companyAI.questions.getRecent(10),
        ]);
        if (cancelled) {
          return;
        }
        if (statusResult.ok) {
          setStatus(statusResult.data);
          setCurrent(statusResult.data.current);
        }
        if (currentResult.ok) {
          setCurrent(currentResult.data);
        }
        if (recentResult.ok) {
          setRecent(recentResult.data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Question panel failed to load');
        }
      }
    }

    void bootstrap();

    unsubscribers.push(
      window.companyAI.questions.onDetected((event) => {
        if (event.question) {
          setCurrent(event.question);
          setRecent((prev) => [...prev.filter((item) => item.id !== event.question!.id), event.question!].slice(-10));
        }
      }),
    );
    unsubscribers.push(
      window.companyAI.questions.onClassified((event) => {
        if (event.question) {
          setCurrent(event.question);
          setRecent((prev) => {
            const without = prev.filter((item) => item.id !== event.question!.id);
            return [...without, event.question!].slice(-10);
          });
        }
      }),
    );
    unsubscribers.push(
      window.companyAI.session.onStatusChanged((snapshot) => {
        if (snapshot.state === 'idle' || snapshot.state === 'stopping') {
          void window.companyAI.questions.getStatus().then((result) => {
            if (result.ok) {
              setStatus(result.data);
            }
          });
        }
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
    const result = await window.companyAI.questions.clear();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setCurrent(null);
    setRecent([]);
    const statusResult = await window.companyAI.questions.getStatus();
    if (statusResult.ok) {
      setStatus(statusResult.data);
    }
  }

  return (
    <section className="question-panel" aria-label="Question understanding">
      <div className="question-panel__block">
        <div className="question-panel__heading">
          <h2>Question Detection</h2>
          <span className={`question-panel__badge ${status?.listening ? 'is-live' : 'is-idle'}`}>
            {status?.listening ? 'Listening for questions' : 'Paused'}
          </span>
        </div>

        {error ? (
          <p className="question-panel__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="question-panel__current">
          <h3>Detected question</h3>
          {current ? (
            <>
              <p className="question-panel__text">{current.text}</p>
              <dl className="question-panel__meta">
                <div>
                  <dt>Type</dt>
                  <dd>{formatType(current.type)}</dd>
                </div>
                <div>
                  <dt>Detection confidence</dt>
                  <dd>{percent(current.detectionConfidence)}</dd>
                </div>
                <div>
                  <dt>Classification confidence</dt>
                  <dd>{percent(current.classificationConfidence)}</dd>
                </div>
              </dl>
              {current.isMultiPart ? (
                <ul className="question-panel__parts">
                  {current.parts.map((part) => (
                    <li key={part}>{part}</li>
                  ))}
                </ul>
              ) : null}
              {current.parentQuestionId ? (
                <p className="question-panel__relation">Related to previous question</p>
              ) : null}
            </>
          ) : (
            <p className="question-panel__empty">No question detected yet. Speak a clear interview question after Start.</p>
          )}
        </div>

        <div className="question-panel__actions">
          <button type="button" onClick={() => void handleClear()}>
            Clear questions
          </button>
        </div>
      </div>

      <div className="question-panel__block">
        <h2>Recent Questions</h2>
        {recent.length === 0 ? (
          <p className="question-panel__empty">No classified questions yet.</p>
        ) : (
          <ol className="question-panel__list">
            {[...recent].reverse().map((question, index) => (
              <li key={question.id}>
                <span className="question-panel__index">{index + 1}.</span>
                <div>
                  <p>{question.text}</p>
                  <small>{formatType(question.type)}</small>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
