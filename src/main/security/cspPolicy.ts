/** Development CSP — allows Vite HMR websockets and inline styles used by Vite. */
export const DEVELOPMENT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:* http://127.0.0.1:* ws://127.0.0.1:*";

/**
 * Production CSP — no unsafe-inline scripts; styles come from bundled CSS files.
 * Do not weaken script-src for convenience.
 */
export const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
