import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_CSP, PRODUCTION_CSP } from '../../src/main/security/cspPolicy';

describe('CSP policy constants', () => {
  it('keeps scripts free of unsafe-inline in both environments', () => {
    expect(DEVELOPMENT_CSP.includes("script-src 'self'")).toBe(true);
    expect(DEVELOPMENT_CSP.includes("script-src 'self' 'unsafe-inline'")).toBe(false);
    expect(PRODUCTION_CSP.includes("script-src 'self'")).toBe(true);
    expect(PRODUCTION_CSP.includes('unsafe-inline')).toBe(false);
  });

  it('allows style unsafe-inline only in development policy', () => {
    expect(DEVELOPMENT_CSP.includes("style-src 'self' 'unsafe-inline'")).toBe(true);
    expect(PRODUCTION_CSP.includes("style-src 'self'")).toBe(true);
    expect(PRODUCTION_CSP.includes("style-src 'self' 'unsafe-inline'")).toBe(false);
  });
});
