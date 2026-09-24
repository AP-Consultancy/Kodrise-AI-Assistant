import { useEffect, useState } from 'react';
import type { InterviewStatus } from '../../shared/interview/types';
import type { SimulationPublicStatus } from '../../shared/simulation/types';
import { useInterviewListening } from '../hooks/useInterviewListening';
import './liveInterview.css';

interface LiveInterviewPageProps {
  status: InterviewStatus;
  onEnded: () => void;
}

function friendlyListenError(message: string): string {
  if (/permission|NotAllowed|denied/i.test(message)) {
    return 'Microphone permission is required to listen during the interview.';
  }
  if (/not configured|speech recognition/i.test(message)) {
    return 'Speech recognition is not configured. Open Settings to connect your speech provider.';
  }
  if (/interrupt|disconnect|closed|network|WebSocket|Deepgram|ECONN|ETIMEDOUT/i.test(message)) {
    return 'Your microphone connection was interrupted.';
  }
  if (
    /stack|ENOENT|EACCES|at\s+\S+\s+\(|[A-Za-z]:\\|\/Users\//i.test(message) ||
    message.length > 180
  ) {
    return 'Something went wrong with the microphone. Try Pause and Resume.';
  }
  return message;
}

export function LiveInterviewPage({ status, onEnded }: LiveInterviewPageProps) {
  const simulationMode = status.executionMode === 'simulation';
  const listeningActive = status.phase === 'live' && !status.paused && !simulationMode;
  const { error: listenError, starting } = useInterviewListening(listeningActive);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [manualQuestion, setManualQuestion] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [simulation, setSimulation] = useState<SimulationPublicStatus | null>(null);

  const answerText =
    status.paused || status.phase !== 'live'
      ? status.answerText
      : (streamText ?? status.answerText);

  const simulationActive = Boolean(simulation?.interviewStarted && !simulation.interviewCompleted);
  const displayQuestion =
    simulationActive && simulation?.currentQuestion
      ? simulation.currentQuestion
      : status.currentQuestionText;
  const displayCategory = simulationActive ? simulation?.category : null;
  const displayDifficulty = simulationActive ? simulation?.difficulty : null;
  const displayKeyPoints = simulationActive ? (simulation?.keyPoints ?? []) : [];

  useEffect(() => {
    let cancelled = false;
    void window.companyAI.simulation.getStatus().then((result) => {
      if (!cancelled && result.ok) setSimulation(result.data);
    });
    const unsub = window.companyAI.simulation.onStatusChanged((next) => {
      setSimulation(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    const unsubChunk = window.companyAI.ai.onResponseChunk((event) => {
      if (event.textDelta) {
        setStreamText((prev) => (prev ?? '') + event.textDelta);
      }
    });
    const unsubStart = window.companyAI.ai.onResponseStarted(() => {
      setStreamText('');
    });
    const unsubDone = window.companyAI.ai.onResponseCompleted(async () => {
      const result = await window.companyAI.ai.getCurrentResponse();
      if (result.ok && result.data) {
        setStreamText(result.data.text);
      }
    });
    return () => {
      unsubChunk();
      unsubStart();
      unsubDone();
    };
  }, []);

  async function pause() {
    setBusy(true);
    setLocalError(null);
    setStreamText(null);
    try {
      if (simulationActive) {
        const sim = await window.companyAI.simulation.pause();
        if (!sim.ok) setLocalError(sim.error.message);
        return;
      }
      const result = await window.companyAI.interview.pause();
      if (!result.ok) setLocalError(result.error.message);
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    setBusy(true);
    setLocalError(null);
    try {
      if (simulationActive || simulation?.paused) {
        const sim = await window.companyAI.simulation.resume();
        if (!sim.ok) setLocalError(sim.error.message);
        return;
      }
      const result = await window.companyAI.interview.resume();
      if (!result.ok) setLocalError(result.error.message);
    } finally {
      setBusy(false);
    }
  }

  async function endInterview() {
    setBusy(true);
    setLocalError(null);
    try {
      if (simulation?.interviewStarted || status.executionMode === 'simulation') {
        await window.companyAI.simulation.end();
      }
      const result = await window.companyAI.interview.end();
      if (!result.ok) {
        setLocalError(result.error.message);
        return;
      }
      setConfirmEnd(false);
      setStreamText(null);
      onEnded();
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    setLocalError(null);
    try {
      const result = await window.companyAI.interview.regenerate();
      if (!result.ok) setLocalError(result.error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitManual() {
    const text = manualQuestion.trim();
    if (!text) return;
    setBusy(true);
    setLocalError(null);
    try {
      const result = await window.companyAI.interview.submitQuestion(text);
      if (!result.ok) {
        setLocalError(result.error.message);
        return;
      }
      setManualQuestion('');
    } finally {
      setBusy(false);
    }
  }

  async function runSimulationAction(
    action: 'start' | 'pause' | 'resume' | 'next' | 'restart' | 'end',
  ) {
    setBusy(true);
    setLocalError(null);
    try {
      const result = await window.companyAI.simulation[action]();
      if (!result.ok) setLocalError(result.error.message);
      else setSimulation(result.data);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutoAdvance() {
    if (!simulation) return;
    setBusy(true);
    try {
      const result = await window.companyAI.simulation.updateConfig({
        autoAdvance: !simulation.config.autoAdvance,
      });
      if (result.ok) setSimulation(result.data);
    } finally {
      setBusy(false);
    }
  }

  const error =
    (listenError && !simulationMode ? friendlyListenError(listenError) : null) ||
    localError ||
    status.errorMessage;

  const statusLabel = simulationMode
    ? simulation?.waitingForAnswer
      ? 'Generating answer'
      : simulation?.answerReady
        ? 'Ready'
        : simulationActive
          ? 'Interview Simulation'
          : status.uiStateLabel
    : starting
      ? 'Starting microphone…'
      : status.uiStateLabel;

  return (
    <section className="live" aria-labelledby="live-status">
      <div className="live__status-row">
        <p id="live-status" className="live__status" aria-live="polite">
          {statusLabel}
        </p>
      </div>

      {error ? (
        <p className="live__error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="live__sim" aria-labelledby="sim-heading">
        <h2 id="sim-heading">Interview Simulation</h2>
        <p className="live__sim-lede">
          Java interview practice with Mock AI. Microphone questions are disabled in this mode.
        </p>
        <p className="live__meta">
          Candidate profile: {simulation?.candidateProfile ?? '3+ Years Java Backend Developer'}
        </p>
        {simulationActive ? (
          <p className="live__sim-progress">
            Progress: Question {simulation?.progress.currentIndex} / {simulation?.progress.totalQuestions}
            {simulation?.difficulty ? ` · ${simulation.difficulty}` : ''}
            {simulation?.isFollowUp ? ' · Follow-up' : ''}
            {simulation?.paused ? ' · Paused' : ''}
            {simulation?.config.autoAdvance ? ' · Auto-advance on' : ' · Manual next'}
          </p>
        ) : simulation?.interviewCompleted ? (
          <p className="live__sim-progress">Interview Complete</p>
        ) : null}
        <div className="live__sim-actions">
          {!simulationActive && !simulation?.interviewCompleted ? (
            <button type="button" disabled={busy} onClick={() => void runSimulationAction('start')}>
              Start Simulation
            </button>
          ) : null}
          {simulation?.interviewCompleted ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void runSimulationAction('restart')}
            >
              Restart Simulation
            </button>
          ) : null}
          {simulationActive ? (
            <>
              <button
                type="button"
                disabled={busy || !simulation?.answerReady}
                onClick={() => void runSimulationAction('next')}
              >
                Next Question
              </button>
              {simulation?.paused ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runSimulationAction('resume')}
                >
                  Resume Simulation
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runSimulationAction('pause')}
                >
                  Pause Simulation
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => void toggleAutoAdvance()}>
                {simulation?.config.autoAdvance ? 'Disable auto-advance' : 'Enable auto-advance'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runSimulationAction('restart')}
              >
                Restart
              </button>
              <button type="button" disabled={busy} onClick={() => void runSimulationAction('end')}>
                End Simulation
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="live__question" aria-labelledby="current-question-heading">
        <h2 id="current-question-heading">Interviewer question</h2>
        <p className="live__question-text">
          {displayQuestion ?? 'Waiting for the next question…'}
        </p>
        {displayCategory || displayDifficulty ? (
          <p className="live__meta">
            {[
              displayCategory ? `Category: ${displayCategory}` : null,
              displayDifficulty ? `Difficulty: ${displayDifficulty}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
      </section>

      <section className="live__answer" aria-labelledby="answer-heading">
        <div className="live__answer-head">
          <h2 id="answer-heading">Answer</h2>
          {status.currentQuestionId && !status.paused && !simulationMode ? (
            <button type="button" disabled={busy} onClick={() => void regenerate()}>
              Regenerate
            </button>
          ) : null}
        </div>
        <div className="live__answer-body" tabIndex={0}>
          {answerText ? answerText : <span className="live__placeholder">Answer will appear here.</span>}
        </div>
      </section>

      {displayKeyPoints.length > 0 ? (
        <section className="live__keypoints" aria-labelledby="keypoints-heading">
          <h2 id="keypoints-heading">Key points</h2>
          <ul>
            {displayKeyPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {!simulationMode ? (
        <form
          className="live__manual"
          onSubmit={(event) => {
            event.preventDefault();
            void submitManual();
          }}
        >
          <label htmlFor="manual-question">Paste a question</label>
          <div className="live__manual-row">
            <input
              id="manual-question"
              value={manualQuestion}
              onChange={(event) => setManualQuestion(event.target.value)}
              placeholder="Optional — paste a question if needed"
              disabled={busy || status.paused}
            />
            <button type="submit" disabled={busy || status.paused || !manualQuestion.trim()}>
              Ask
            </button>
          </div>
        </form>
      ) : null}

      <div className="live__actions">
        {!simulationMode ? (
          status.paused ? (
            <button type="button" className="live__secondary" disabled={busy} onClick={() => void resume()}>
              Resume
            </button>
          ) : (
            <button type="button" className="live__secondary" disabled={busy} onClick={() => void pause()}>
              Pause
            </button>
          )
        ) : (
          <span />
        )}
        <button
          type="button"
          className="live__danger"
          disabled={busy}
          onClick={() => setConfirmEnd(true)}
        >
          End Interview
        </button>
      </div>

      {confirmEnd ? (
        <div className="live__dialog-backdrop" role="presentation">
          <div
            className="live__dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="end-title"
            aria-describedby="end-desc"
          >
            <h3 id="end-title">End this interview session?</h3>
            <p id="end-desc">Listening and answer generation will stop.</p>
            <div className="live__dialog-actions">
              <button type="button" autoFocus disabled={busy} onClick={() => setConfirmEnd(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="live__danger"
                disabled={busy}
                onClick={() => void endInterview()}
              >
                End Interview
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
