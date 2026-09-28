import { useEffect, useState } from 'react';
import type {
  ProblemIntelligenceStatus,
  ProblemResult,
  ProgrammingLanguage,
  SqlDialect,
} from '../../shared/problem-intelligence/types';
import { PROGRAMMING_LANGUAGES, SQL_DIALECTS } from '../../shared/problem-intelligence/types';
import './problemSolverPanel.css';

export function ProblemSolverPanel() {
  const [status, setStatus] = useState<ProblemIntelligenceStatus | null>(null);
  const [result, setResult] = useState<ProblemResult | null>(null);
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<ProgrammingLanguage | 'auto'>('auto');
  const [dialect, setDialect] = useState<SqlDialect | 'auto'>('auto');
  const [revision, setRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const [statusResult, current] = await Promise.all([
      window.companyAI.problem.getStatus(),
      window.companyAI.problem.getCurrent(),
    ]);
    if (statusResult.ok) setStatus(statusResult.data);
    if (current.ok) setResult(current.data);
  }

  useEffect(() => {
    let cancelled = false;
    void window.companyAI.problem.getStatus().then((statusResult) => {
      if (!cancelled && statusResult.ok) setStatus(statusResult.data);
    });
    void window.companyAI.problem.getCurrent().then((current) => {
      if (!cancelled && current.ok) setResult(current.data);
    });
    const unsub = window.companyAI.problem.onEvent(() => {
      void window.companyAI.problem.getStatus().then((statusResult) => {
        if (!cancelled && statusResult.ok) setStatus(statusResult.data);
      });
      void window.companyAI.problem.getCurrent().then((current) => {
        if (!cancelled && current.ok) setResult(current.data);
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await window.companyAI.problem.create({
        text,
        source: 'manual',
        language,
        sqlDialect: dialect,
      });
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setResult(response.data);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function changeLanguage(next: ProgrammingLanguage) {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const response = await window.companyAI.problem.selectLanguage({
        problemId: result.problemId,
        language: next,
      });
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setResult(response.data);
      setLanguage(next);
    } finally {
      setBusy(false);
    }
  }

  async function changeDialect(next: SqlDialect) {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const response = await window.companyAI.problem.selectDialect({
        problemId: result.problemId,
        dialect: next,
      });
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setResult(response.data);
      setDialect(next);
    } finally {
      setBusy(false);
    }
  }

  async function applyRevision() {
    if (!result || !revision.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await window.companyAI.problem.revise({
        problemId: result.problemId,
        constraintDelta: revision.trim(),
      });
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setResult(response.data);
      setRevision('');
    } finally {
      setBusy(false);
    }
  }

  async function runExecute() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const response = await window.companyAI.problem.execute({
        problemId: result.problemId,
        mode: 'solution',
      });
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setResult(response.data);
    } finally {
      setBusy(false);
    }
  }

  const solutionText =
    result?.solution.code ??
    result?.solution.correctedCode ??
    result?.solution.sql ??
    '';

  return (
    <section className="problem-solver glass" aria-labelledby="problem-solver-title">
      <header className="problem-solver__head">
        <div>
          <h2 id="problem-solver-title">Problem Solver</h2>
          <p className="problem-solver__lede">
            Prefer Capture question (hotkey) during a live interview. Manual paste remains a fallback
            only.
          </p>
        </div>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      {error ? (
        <p className="problem-solver__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="problem-solver__grid">
        <label className="problem-solver__field">
          <span>Problem</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Paste or type a coding / SQL / debugging problem…"
            disabled={busy}
          />
        </label>

        <div className="problem-solver__row">
          <label>
            <span>Language</span>
            <select
              value={language}
              disabled={busy}
              onChange={(e) => {
                const value = e.target.value as ProgrammingLanguage | 'auto';
                setLanguage(value);
                if (result && value !== 'auto') void changeLanguage(value);
              }}
            >
              <option value="auto">Auto</option>
              {PROGRAMMING_LANGUAGES.filter((l) => l !== 'unknown').map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>SQL dialect</span>
            <select
              value={dialect}
              disabled={busy}
              onChange={(e) => {
                const value = e.target.value as SqlDialect | 'auto';
                setDialect(value);
                if (result && value !== 'auto') void changeDialect(value);
              }}
            >
              <option value="auto">Auto</option>
              {SQL_DIALECTS.filter((d) => d !== 'unknown').map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="problem-solver__actions">
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !text.trim()}
            onClick={() => void create()}
          >
            Solve
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !result}
            onClick={() => void runExecute()}
          >
            Execute
          </button>
          <button
            type="button"
            className="btn-tertiary"
            disabled={busy}
            onClick={() => {
              void window.companyAI.problem.reset().then(() => {
                setResult(null);
                void refresh();
              });
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {status ? (
        <p className="problem-solver__meta">
          Problems: {status.problemCount}
          {' · '}
          Code sandbox: {status.codeExecutionAvailable ? 'ready' : 'unavailable'}
          {' · '}
          SQL sandbox: {status.sqlExecutionAvailable ? 'ready' : 'unavailable'}
        </p>
      ) : null}

      {result ? (
        <div className="problem-solver__result reading-zone">
          <div className="problem-solver__kv">
            <div>
              <span>Type</span>
              <strong>{result.type}</strong>
            </div>
            <div>
              <span>Language</span>
              <strong>{result.language}</strong>
            </div>
            <div>
              <span>Dialect</span>
              <strong>{result.sqlDialect}</strong>
            </div>
            <div>
              <span>Verification</span>
              <strong>{result.verificationStatus}</strong>
            </div>
          </div>

          <section>
            <h3>Problem</h3>
            <pre className="problem-solver__block">{result.normalizedProblem.statement}</pre>
          </section>

          <section>
            <h3>Solution</h3>
            <pre className="problem-solver__code">{solutionText || '—'}</pre>
          </section>

          {result.complexity ? (
            <section>
              <h3>Complexity</h3>
              <p>
                Time: {result.complexity.timeComplexity}
                {' · '}
                Space: {result.complexity.spaceComplexity}
              </p>
              <p className="problem-solver__muted">{result.complexity.reasoning}</p>
            </section>
          ) : null}

          {result.testCases.length > 0 ? (
            <section>
              <h3>Tests</h3>
              <p>{result.testCases.length} generated</p>
              <ul className="problem-solver__tests">
                {result.testCases.slice(0, 8).map((t) => (
                  <li key={t.id}>
                    <strong>{t.description}</strong>
                    <span>
                      {t.input} → {t.expectedOutput}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h3>Output</h3>
            {result.executionResult ? (
              <pre className="problem-solver__block">
                {result.executionResult.stdout ||
                  result.executionResult.errorMessage ||
                  result.executionResult.state}
              </pre>
            ) : result.sqlExecutionResult?.table ? (
              <pre className="problem-solver__block">
                {JSON.stringify(result.sqlExecutionResult.table, null, 2)}
              </pre>
            ) : (
              <p className="problem-solver__muted">No execution output yet.</p>
            )}
          </section>

          <section>
            <h3>Explanation</h3>
            <p>{result.explanation}</p>
          </section>

          {result.warnings.length > 0 ? (
            <section>
              <h3>Warnings</h3>
              <ul>
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <label className="problem-solver__field">
            <span>Follow-up constraint</span>
            <input
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              placeholder='e.g. "Now do it without extra space"'
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !revision.trim()}
            onClick={() => void applyRevision()}
          >
            Apply revision
          </button>
        </div>
      ) : null}
    </section>
  );
}
