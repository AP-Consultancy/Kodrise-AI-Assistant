import type { ReactNode } from 'react';
import './productShell.css';
import type { ShellDestination } from '../navigation/productNavigation';
import { resolveNavHighlight } from '../navigation/productNavigation';

interface ProductShellProps {
  destination: ShellDestination;
  onNavigate: (destination: ShellDestination) => void;
  live: boolean;
  children: ReactNode;
}

const NAV: Array<{ id: 'session' | 'settings'; label: string }> = [
  { id: 'session', label: 'Interview' },
  { id: 'settings', label: 'Settings' },
];

export function ProductShell({ destination, onNavigate, live, children }: ProductShellProps) {
  const activeNav = resolveNavHighlight(destination);

  return (
    <div className="product">
      <a className="product__skip" href="#product-main">
        Skip to content
      </a>
      <header className="product__header">
        <div className="product__brand">
          <p className="product__brand-name">AP AI Assistant</p>
          {live ? (
            <span className="product__live" aria-label="Interview live">
              <span className="product__live-dot" aria-hidden="true" />
              LIVE
            </span>
          ) : null}
        </div>
        <nav className="product__nav" aria-label="Primary">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeNav === item.id ? 'product__nav-item is-active' : 'product__nav-item'}
              aria-current={activeNav === item.id ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main id="product-main" className="product__main">
        {children}
      </main>
    </div>
  );
}

export type { ShellDestination };
