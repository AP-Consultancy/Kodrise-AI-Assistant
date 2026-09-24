import type { InterviewProductPhase } from '../../shared/interview/types';

/** Top-level shell destinations — Settings is separate; interview is one workflow. */
export type ShellDestination = 'session' | 'settings' | 'diagnostics';

/** Concrete view rendered inside the shell. */
export type ProductView = 'prepare' | 'live' | 'summary' | 'settings' | 'diagnostics';

/**
 * Resolves which page to show.
 * InterviewHost phase is the source of truth for prepare → live → summary.
 * Live is never shown unless phase === 'live' (blocks empty interview screens).
 */
export function resolveProductView(input: {
  destination: ShellDestination;
  phase: InterviewProductPhase;
  hasSummary: boolean;
}): ProductView {
  if (input.destination === 'settings') {
    return 'settings';
  }
  if (input.destination === 'diagnostics') {
    return 'diagnostics';
  }

  if (input.phase === 'live') {
    return 'live';
  }
  if (input.phase === 'summary' && input.hasSummary) {
    return 'summary';
  }
  // prepare, or summary without payload, or any attempt to force live without a session
  return 'prepare';
}

/** Primary nav highlight — diagnostics counts as Settings. */
export function resolveNavHighlight(destination: ShellDestination): 'session' | 'settings' {
  return destination === 'session' ? 'session' : 'settings';
}
