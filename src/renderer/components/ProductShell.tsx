import { useEffect, useMemo, useState, type ReactNode } from 'react';
import './productShell.css';
import type { ShellDestination } from '../navigation/productNavigation';
import { resolveNavHighlight } from '../navigation/productNavigation';
import type { DetectedQuestion } from '../../shared/questions/types';

interface ProductShellProps {
  destination: ShellDestination;
  onNavigate: (destination: ShellDestination) => void;
  live: boolean;
  paused?: boolean;
  modeLabel?: string;
  startedAt?: number | null;
  children: ReactNode;
}

const NAV: Array<{ id: 'session' | 'settings'; label: string; glyph: string }> = [
  { id: 'session', label: 'Interview', glyph: '◎' },
  { id: 'settings', label: 'Settings', glyph: '⚙' },
];

function formatElapsedAt(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function ProductShell({
  destination,
  onNavigate,
  live,
  paused = false,
  modeLabel = 'Session',
  startedAt = null,
  children,
}: ProductShellProps) {
  const activeNav = resolveNavHighlight(destination);
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [recentQuestions, setRecentQuestions] = useState<DetectedQuestion[]>([]);

  useEffect(() => {
    if (!live || !startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live, startedAt]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    async function refresh() {
      const result = await window.companyAI.questions.getRecent(12);
      if (!cancelled && result.ok) setRecentQuestions(result.data);
    }
    void refresh();
    const unsub = window.companyAI.questions.onClassified(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [live]);

  const elapsed = live && startedAt ? formatElapsedAt(startedAt, now) : '00:00';

  const questionItems = useMemo(() => {
    if (!live) return [];
    return [...recentQuestions].reverse().map((question, index, all) => ({
      id: question.id,
      label: `Q${all.length - index} ${question.text.slice(0, 42)}${
        question.text.length > 42 ? '…' : ''
      }`,
      current: index === 0,
    }));
  }, [live, recentQuestions]);

  return (
    <div className="product">
      <a className="product__skip" href="#product-main">
        Skip to content
      </a>

      <aside
        className={collapsed ? 'product__sidebar is-collapsed' : 'product__sidebar'}
        aria-label="Application"
      >
        <div className="product__brand-block">
          <p className="product__brand-name">AP AI</p>
          <button
            type="button"
            className="product__collapse"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        <nav className="product__side-nav" aria-label="Primary">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeNav === item.id ? 'product__nav-item is-active' : 'product__nav-item'}
              aria-current={activeNav === item.id ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <span className="product__nav-glyph" aria-hidden="true">
                {item.glyph}
              </span>
              <span className="product__nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {live && questionItems.length > 0 ? (
          <div className="product__side-section">
            <p className="product__side-section-label">Today</p>
            <ul className="product__question-list">
              {questionItems.map((item) => (
                <li
                  key={item.id}
                  className={
                    item.current ? 'product__question-item is-current' : 'product__question-item'
                  }
                  title={item.label}
                >
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="product__side-section">
            <button
              type="button"
              className="product__nav-item"
              onClick={() => onNavigate('session')}
            >
              <span className="product__nav-glyph" aria-hidden="true">
                +
              </span>
              <span className="product__nav-label">New Interview</span>
            </button>
          </div>
        )}
      </aside>

      <div className="product__workspace">
        <header className="product__topbar">
          <div className="product__topbar-left">
            <p className="product__mode">{modeLabel}</p>
            {live ? (
              <span
                className={paused ? 'product__live is-paused' : 'product__live'}
                aria-label={paused ? 'Interview paused' : 'Listening'}
              >
                <span className="product__live-dot" aria-hidden="true" />
                {paused ? 'Paused' : 'Listening'}
              </span>
            ) : null}
          </div>
          {live ? (
            <time className="product__timer" dateTime={`PT${elapsed.replace(':', 'M')}S`}>
              {elapsed}
            </time>
          ) : (
            <span className="product__timer" aria-hidden="true">
              AP AI
            </span>
          )}
        </header>
        <main
          id="product-main"
          className={live && destination === 'session' ? 'product__main is-live' : 'product__main'}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export type { ShellDestination };
