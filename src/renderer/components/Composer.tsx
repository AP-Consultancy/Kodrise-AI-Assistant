import { useRef, type FormEvent, type KeyboardEvent } from 'react';
import './composer.css';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled = false,
  placeholder = 'Ask anything about the interview…',
}: ComposerProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!disabled && value.trim()) onSubmit();
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!disabled && value.trim()) onSubmit();
  }

  return (
    <form className="composer" onSubmit={handleSubmit} aria-label="Ask a question">
      <label className="composer__sr" htmlFor="interview-composer">
        Ask a question
      </label>
      <textarea
        ref={areaRef}
        id="interview-composer"
        className="composer__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
      />
      <div className="composer__toolbar">
        <p className="composer__hint">Enter to send · Shift+Enter for newline</p>
        <button
          type="submit"
          className="composer__send"
          disabled={disabled || !value.trim()}
          aria-label="Send question"
          title="Send question"
        >
          ↑
        </button>
      </div>
    </form>
  );
}
