import { useEffect, useMemo, useRef, useState } from 'react';
import type { InterviewStatus } from '../../shared/interview/types';
import type { SimulationPublicStatus } from '../../shared/simulation/types';
import { useInterviewListening } from '../hooks/useInterviewListening';
import {
  ConversationTimeline,
  type ConversationExchange,
} from './ConversationTimeline';
import { Composer } from './Composer';
import './liveInterview.css';

interface LiveInterviewPageProps {
  status: InterviewStatus;
  onEnded: () => void;
}

interface PastExchange {
  id: string;
  question: string;
  answer: string;
  category?: string | null;
  difficulty?: string | null;
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

function friendlyAiError(message: string): string {
  if (/quota|billing/i.test(message)) {
    return 'AI temporarily unavailable. The selected provider hit a usage limit.';
  }
  if (/api key|authentication|unauthorized|invalid/i.test(message)) {
    return 'AI temporarily unavailable. Check your API key in Settings.';
  }
  if (/network|connect|timeout/i.test(message)) {
    return 'AI temporarily unavailable. Check your connection and try again.';
  }
  if (/model.*unavailable|not found/i.test(message)) {
    return 'AI temporarily unavailable. Update the model in Settings and retry.';
  }
  if (message.length > 160 || /Error:|Exception|stack/i.test(message)) {
    return 'AI temporarily unavailable. The selected provider could not generate a response.';
  }
  return message;
}

export function LiveInterviewPage({ status, onEnded }: LiveInterviewPageProps) {
  const simulationMode = status.executionMode === 'simulation';
  const listeningActive = status.phase === 'live' && !status.paused && !simulationMode;
  const { error: listenError, starting, statusHint } = useInterviewListening(listeningActive);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [manualQuestion, setManualQuestion] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [simulation, setSimulation] = useState<SimulationPublicStatus | null>(null);
  const [pastExchanges, setPastExchanges] = useState<PastExchange[]>([]);
  const [multipleQuestions, setMultipleQuestions] = useState<string[]>([]);
  const lastCompletedId = useRef<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

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
  const generating =
    status.uiState === 'generating' ||
    status.uiState === 'building_context' ||
    Boolean(simulation?.waitingForAnswer);

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
    return window.companyAI.questionCapture.onEvent((event) => {
      if (event.type === 'capture.multiple_questions' && event.questions?.length) {
        setMultipleQuestions(event.questions);
      }
      if (event.type === 'capture.failed' && event.message) {
        setLocalError(event.message);
      }
      if (event.type === 'capture.completed' || event.type === 'capture.cancelled') {
        setMultipleQuestions([]);
      }
    });
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

  // Archive completed exchanges when the question changes.
  useEffect(() => {
    const questionId = status.currentQuestionId;
    if (!questionId) return;
    if (
      lastCompletedId.current &&
      lastCompletedId.current !== questionId &&
      status.answerText.trim()
    ) {
      // Handled below when question id flips with prior content tracked via stream.
    }
  }, [status.currentQuestionId, status.answerText]);

  useEffect(() => {
    const questionId = status.currentQuestionId;
    const questionText = displayQuestion;
    if (!questionId || !questionText) return;

    if (lastCompletedId.current && lastCompletedId.current !== questionId) {
      setPastExchanges((prev) => {
        if (prev.some((item) => item.id === lastCompletedId.current)) return prev;
        return prev;
      });
    }

    if (
      !generating &&
      answerText.trim() &&
      questionId &&
      lastCompletedId.current !== questionId &&
      status.uiState === 'ready'
    ) {
      setPastExchanges((prev) => {
        if (prev.some((item) => item.id === questionId)) {
          return prev.map((item) =>
            item.id === questionId ? { ...item, answer: answerText, question: questionText } : item,
          );
        }
        return [
          ...prev,
          {
            id: questionId,
            question: questionText,
            answer: answerText,
            category: displayCategory,
            difficulty: displayDifficulty,
          },
        ];
      });
      lastCompletedId.current = questionId;
    }
  }, [
    answerText,
    displayCategory,
    displayDifficulty,
    displayQuestion,
    generating,
    status.currentQuestionId,
    status.uiState,
  ]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, [answerText, displayQuestion, pastExchanges.length]);

  async function pause() {
    setBusy(true);
    setLocalError(null);
    setStreamText(null);
    try {
      if (simulationActive) {
        const sim = await window.companyAI.simulation.pause();
        if (!sim.ok) setLocalError(friendlyAiError(sim.error.message));
        return;
      }
      const result = await window.companyAI.interview.pause();
      if (!result.ok) setLocalError(friendlyAiError(result.error.message));
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
        if (!sim.ok) setLocalError(friendlyAiError(sim.error.message));
        return;
      }
      const result = await window.companyAI.interview.resume();
      if (!result.ok) setLocalError(friendlyAiError(result.error.message));
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
        setLocalError(friendlyAiError(result.error.message));
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
      if (!result.ok) setLocalError(friendlyAiError(result.error.message));
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
        setLocalError(friendlyAiError(result.error.message));
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
      if (!result.ok) setLocalError(friendlyAiError(result.error.message));
      else setSimulation(result.data);
    } finally {
      setBusy(false);
    }
  }

  const error =
    (listenError && !simulationMode ? friendlyListenError(listenError) : null) ||
    (localError ? friendlyAiError(localError) : null) ||
    (status.errorMessage ? friendlyAiError(status.errorMessage) : null);

  const statusLabel = simulationMode
    ? simulation?.waitingForAnswer
      ? 'Generating'
      : simulation?.answerReady
        ? 'Ready'
        : simulationActive
          ? 'Simulation'
          : status.uiStateLabel
    : starting
      ? 'Starting microphone…'
      : statusHint || status.uiStateLabel;

  const exchanges: ConversationExchange[] = useMemo(() => {
    const archived = pastExchanges
      .filter((item) => item.id !== status.currentQuestionId)
      .map((item) => ({
        ...item,
        generating: false,
        current: false,
      }));

    if (!displayQuestion) {
      return archived;
    }

    const currentId = status.currentQuestionId ?? `current-${displayQuestion.slice(0, 24)}`;
    return [
      ...archived,
      {
        id: currentId,
        question: displayQuestion,
        answer: answerText,
        category: displayCategory,
        difficulty: displayDifficulty,
        generating,
        current: true,
      },
    ];
  }, [
    answerText,
    displayCategory,
    displayDifficulty,
    displayQuestion,
    generating,
    pastExchanges,
    status.currentQuestionId,
  ]);

  return (
    <section className="live" aria-labelledby="live-status">
      <div className="live__chrome">
        <div className="live__status-cluster">
          <p id="live-status" className="live__status" aria-live="polite">
            <span className="live__status-dot" aria-hidden="true" />
            {statusLabel}
          </p>
          <p className="live__status-quiet">
            {status.documents.resume ? '✓ Context' : '○ Context'}
            {' · '}
            ✦ AI
          </p>
        </div>
        <div className="live__chrome-actions">
          {status.currentQuestionId && !status.paused && !simulationMode ? (
            <button type="button" className="live__ghost" disabled={busy} onClick={() => void regenerate()}>
              Regenerate
            </button>
          ) : null}
          {!simulationMode ? (
            status.paused ? (
              <button type="button" className="live__secondary" disabled={busy} onClick={() => void resume()}>
                ▶ Resume
              </button>
            ) : (
              <button type="button" className="live__secondary" disabled={busy} onClick={() => void pause()}>
                Ⅱ Pause
              </button>
            )
          ) : null}
          <button
            type="button"
            className="live__secondary"
            disabled={busy || status.paused || simulationMode}
            onClick={() => {
              void window.companyAI.questionCapture.start().then((result) => {
                if (!result.ok) setLocalError(result.error.message);
              });
            }}
          >
            Capture question
          </button>
          <button type="button" className="live__danger" disabled={busy} onClick={() => setConfirmEnd(true)}>
            End
          </button>
        </div>
      </div>

      {error ? (
        <div className="live__error" role="alert">
          <p className="live__error-title">Something needs attention</p>
          <p>{error}</p>
          {status.currentQuestionId && !simulationMode ? (
            <button type="button" className="live__ghost" disabled={busy} onClick={() => void regenerate()}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {multipleQuestions.length > 0 ? (
        <div className="live__error" role="dialog" aria-label="Multiple questions detected">
          <p className="live__error-title">Multiple questions detected</p>
          <p>Select which question to analyze.</p>
          <div className="live__sim-actions">
            {multipleQuestions.map((q, index) => (
              <button
                key={`${index}-${q.slice(0, 24)}`}
                type="button"
                disabled={busy}
                onClick={() => {
                  void window.companyAI.questionCapture.selectQuestion(index).then((result) => {
                    if (!result.ok) setLocalError(result.error.message);
                    else setMultipleQuestions([]);
                  });
                }}
              >
                {q.length > 80 ? `${q.slice(0, 80)}…` : q}
              </button>
            ))}
            <button type="button" className="live__ghost" onClick={() => setMultipleQuestions([])}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <section className="live__sim" aria-labelledby="sim-heading">
        <div className="live__sim-head">
          <h2 id="sim-heading">Java interview simulation</h2>
          {simulationActive ? (
            <p className="live__sim-progress">
              Question {simulation?.progress.currentIndex} of {simulation?.progress.totalQuestions}
              {displayDifficulty ? ` · ${displayDifficulty}` : ''}
            </p>
          ) : null}
        </div>
        <div className="live__sim-actions">
          {!simulationActive && !simulation?.interviewCompleted ? (
            <button type="button" disabled={busy} onClick={() => void runSimulationAction('start')}>
              Start simulation
            </button>
          ) : null}
          {simulation?.interviewCompleted ? (
            <button type="button" disabled={busy} onClick={() => void runSimulationAction('restart')}>
              Restart simulation
            </button>
          ) : null}
          {simulationActive ? (
            <>
              <button
                type="button"
                disabled={busy || !simulation?.answerReady}
                onClick={() => void runSimulationAction('next')}
              >
                Next question
              </button>
              {simulation?.paused ? (
                <button type="button" disabled={busy} onClick={() => void runSimulationAction('resume')}>
                  Resume
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => void runSimulationAction('pause')}>
                  Pause
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => void runSimulationAction('end')}>
                End simulation
              </button>
            </>
          ) : null}
        </div>
      </section>

      <div className="live__timeline" ref={scrollerRef}>
        <div className="reading-zone">
          <ConversationTimeline
            exchanges={exchanges}
            emptyLabel={simulationMode ? 'Simulation ready' : 'Listening for the next question'}
            emptyHint={
              simulationMode
                ? 'Start the simulation to begin the practice interview.'
                : 'The next detected question will appear here.'
            }
          />
          {displayKeyPoints.length > 0 ? (
            <aside className="live__keypoints" aria-label="Key points">
              <p className="live__keypoints-label">Key points</p>
              <ul>
                {displayKeyPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </aside>
          ) : null}
        </div>
      </div>

      {!simulationMode ? (
        <Composer
          value={manualQuestion}
          onChange={setManualQuestion}
          onSubmit={() => void submitManual()}
          disabled={busy || status.paused}
        />
      ) : null}

      {status.paused ? (
        <div className="live__pause-backdrop">
          <div className="live__pause" role="status">
            <p className="live__pause-title">Interview paused</p>
            <p className="live__pause-copy">Audio and AI paused</p>
            <button type="button" className="live__secondary" disabled={busy} onClick={() => void resume()}>
              ▶ Resume
            </button>
          </div>
        </div>
      ) : null}

      {confirmEnd ? (
        <div className="live__dialog-backdrop" role="presentation">
          <div
            className="live__dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="end-title"
            aria-describedby="end-desc"
          >
            <h3 id="end-title">End this interview?</h3>
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
                End interview
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
