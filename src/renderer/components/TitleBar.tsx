import { useEffect, useState } from 'react';
import './titleBar.css';

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.companyAI.window.isMaximized().then((result) => {
      if (!cancelled && result.ok) {
        setMaximized(result.data.maximized);
        document.documentElement.dataset.maximized = result.data.maximized ? 'true' : 'false';
      }
    });
    const unsub = window.companyAI.window.onMaximizedChanged((state) => {
      setMaximized(state.maximized);
      document.documentElement.dataset.maximized = state.maximized ? 'true' : 'false';
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return (
    <header className="titlebar" aria-label="Window">
      <div className="titlebar__drag">
        <span className="titlebar__brand">AP AI</span>
      </div>
      <div className="titlebar__controls">
        <button
          type="button"
          className="titlebar__btn"
          aria-label="Minimize"
          title="Minimize"
          onClick={() => void window.companyAI.window.minimize()}
        >
          ─
        </button>
        <button
          type="button"
          className="titlebar__btn"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void window.companyAI.window.maximizeToggle()}
        >
          {maximized ? '❐' : '□'}
        </button>
        <button
          type="button"
          className="titlebar__btn titlebar__btn--close"
          aria-label="Close"
          title="Close"
          onClick={() => void window.companyAI.window.close()}
        >
          ×
        </button>
      </div>
    </header>
  );
}
