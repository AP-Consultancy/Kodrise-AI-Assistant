import { memo } from 'react';
import './conversation.css';

export interface ConversationExchange {
  id: string;
  question: string;
  answer: string;
  category?: string | null;
  difficulty?: string | null;
  generating?: boolean;
  current?: boolean;
}

interface ConversationTimelineProps {
  exchanges: ConversationExchange[];
  emptyLabel: string;
  emptyHint: string;
}

function ExchangeBlock({ exchange }: { exchange: ConversationExchange }) {
  const meta = [exchange.category, exchange.difficulty].filter(Boolean).join(' · ');
  return (
    <article
      className={
        exchange.current ? 'conversation__exchange is-current' : 'conversation__exchange is-past'
      }
      aria-current={exchange.current ? 'true' : undefined}
    >
      <div className="conversation__turn conversation__turn--interviewer">
        <div className="conversation__role">
          <span className="conversation__role-label">Interviewer</span>
          {meta ? <span className="conversation__meta">{meta}</span> : null}
        </div>
        <div className="conversation__bubble conversation__bubble--question">{exchange.question}</div>
      </div>

      <div className="conversation__turn conversation__turn--assistant">
        <div className="conversation__role">
          <span className="conversation__role-label">AI Assistant</span>
          {exchange.generating || exchange.answer ? (
            <span
              className={
                exchange.generating
                  ? 'conversation__badge is-generating'
                  : 'conversation__badge is-ready'
              }
              aria-label={exchange.generating ? 'Generating' : 'Ready'}
            >
              {exchange.generating ? '●' : '✓'}
            </span>
          ) : null}
        </div>
        <div className="conversation__bubble conversation__bubble--answer">
          {exchange.answer ? (
            <>
              {exchange.answer}
              {exchange.generating ? <span className="conversation__cursor" aria-hidden="true" /> : null}
            </>
          ) : exchange.generating ? (
            <span className="conversation__placeholder" aria-label="Generating">
              <span className="conversation__cursor" aria-hidden="true" />
            </span>
          ) : (
            <span className="conversation__placeholder">Answer will appear here.</span>
          )}
        </div>
      </div>
    </article>
  );
}

const MemoExchange = memo(ExchangeBlock);

export function ConversationTimeline({
  exchanges,
  emptyLabel,
  emptyHint,
}: ConversationTimelineProps) {
  if (exchanges.length === 0) {
    return (
      <div className="conversation__empty" role="status">
        <p className="conversation__empty-title">{emptyLabel}</p>
        <p className="conversation__empty-hint">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="conversation" aria-live="polite">
      {exchanges.map((exchange) => (
        <MemoExchange key={exchange.id} exchange={exchange} />
      ))}
    </div>
  );
}
