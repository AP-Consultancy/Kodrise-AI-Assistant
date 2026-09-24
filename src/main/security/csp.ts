import { session } from 'electron';
import { PRODUCTION_CSP } from './cspPolicy';

export { DEVELOPMENT_CSP, PRODUCTION_CSP } from './cspPolicy';

/**
 * Apply CSP headers in production builds only.
 * Development relies on the Vite index.html meta CSP so React Fast Refresh
 * preamble / HMR keep working without weakening script-src.
 */
export function applyContentSecurityPolicy(isPackaged: boolean): void {
  if (!isPackaged) {
    return;
  }

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    responseHeaders['Content-Security-Policy'] = [PRODUCTION_CSP];
    callback({ responseHeaders });
  });
}
