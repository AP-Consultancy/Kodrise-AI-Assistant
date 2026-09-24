import type { ReactNode } from 'react';
import './shellLayout.css';

interface ShellLayoutProps {
  children: ReactNode;
}

export function ShellLayout({ children }: ShellLayoutProps) {
  return (
    <div className="shell">
      <header className="shell__header">
        <div>
          <p className="shell__eyebrow">Internal desktop assistant</p>
          <h1 className="shell__title">AP AI Assistance Tool</h1>
        </div>
        <p className="shell__subtitle">
          Secure Electron foundation — React renderer, isolated preload, typed IPC.
        </p>
      </header>
      <main className="shell__main">{children}</main>
    </div>
  );
}
