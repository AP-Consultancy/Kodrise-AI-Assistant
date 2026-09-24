import { describe, expect, it } from 'vitest';
import {
  resolveNavHighlight,
  resolveProductView,
} from '../../src/renderer/navigation/productNavigation';

describe('Product workflow navigation', () => {
  it('uses a single Interview session destination, not Prepare + Interview tabs', () => {
    expect(resolveNavHighlight('session')).toBe('session');
    expect(resolveNavHighlight('settings')).toBe('settings');
    expect(resolveNavHighlight('diagnostics')).toBe('settings');
  });

  it('shows Prepare before a session starts', () => {
    expect(
      resolveProductView({ destination: 'session', phase: 'prepare', hasSummary: false }),
    ).toBe('prepare');
  });

  it('shows LiveInterview automatically when InterviewHost phase is live', () => {
    expect(
      resolveProductView({ destination: 'session', phase: 'live', hasSummary: false }),
    ).toBe('live');
  });

  it('shows Session Summary after end when summary payload exists', () => {
    expect(
      resolveProductView({ destination: 'session', phase: 'summary', hasSummary: true }),
    ).toBe('summary');
  });

  it('routes New Interview / summary-without-payload back to Prepare', () => {
    expect(
      resolveProductView({ destination: 'session', phase: 'summary', hasSummary: false }),
    ).toBe('prepare');
    expect(
      resolveProductView({ destination: 'session', phase: 'prepare', hasSummary: true }),
    ).toBe('prepare');
  });

  it('never renders Live without an active live phase (guards empty interview screen)', () => {
    expect(
      resolveProductView({ destination: 'session', phase: 'prepare', hasSummary: false }),
    ).not.toBe('live');
    expect(
      resolveProductView({ destination: 'session', phase: 'summary', hasSummary: true }),
    ).not.toBe('live');
  });

  it('keeps Settings and Diagnostics as separate destinations over the workflow', () => {
    expect(
      resolveProductView({ destination: 'settings', phase: 'live', hasSummary: false }),
    ).toBe('settings');
    expect(
      resolveProductView({ destination: 'diagnostics', phase: 'prepare', hasSummary: false }),
    ).toBe('diagnostics');
    // Returning to session during live resumes Live from InterviewHost phase
    expect(
      resolveProductView({ destination: 'session', phase: 'live', hasSummary: false }),
    ).toBe('live');
  });
});
