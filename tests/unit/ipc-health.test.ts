import { describe, expect, it } from 'vitest';
import { isTrustedIpcOrigin } from '../../src/main/ipc/originPolicy';
import { AuthorizationError, ValidationError, toSafeErrorPayload } from '../../src/shared/errors';
import { CredentialsSetSchema, ClientSecurityReportSchema } from '../../src/shared/ipc/schemas';
import { buildFoundationChecks } from '../../src/main/ipc/foundationChecks';

describe('IPC contract hardening', () => {
  it('accepts trusted development and production origins', () => {
    expect(isTrustedIpcOrigin('http://localhost:5173/', false)).toBe(true);
    expect(isTrustedIpcOrigin('http://127.0.0.1:5173/index.html', false)).toBe(true);
    expect(isTrustedIpcOrigin('file:///app/index.html', true)).toBe(true);
  });

  it('rejects unauthorized origins', () => {
    expect(isTrustedIpcOrigin('https://evil.example/', false)).toBe(false);
    expect(isTrustedIpcOrigin('http://localhost:5173/', true)).toBe(false);
  });

  it('rejects invalid IPC payloads via schema validation', () => {
    expect(CredentialsSetSchema.safeParse({ key: 'a' }).success).toBe(false);
    expect(ClientSecurityReportSchema.safeParse({ preloadAvailable: true }).success).toBe(false);
  });

  it('maps handler errors to safe renderer payloads without secrets', () => {
    const auth = toSafeErrorPayload(new AuthorizationError('Untrusted IPC origin'));
    expect(auth.code).toBe('AUTHORIZATION');
    expect(auth.message).toBe('Untrusted IPC origin');

    const validation = toSafeErrorPayload(
      new ValidationError('Invalid credentials set payload', { value: 'super-secret' }),
    );
    expect(validation.code).toBe('VALIDATION');
    // details may exist but test ensures raw secret is not required in message
    expect(validation.message).not.toContain('super-secret');
  });

  it('builds accurate diagnostics statuses from client + server signals', () => {
    const checks = buildFoundationChecks({
      client: {
        preloadAvailable: true,
        companyAiApiPresent: true,
        nodeRequirePresent: false,
      },
      configLoaded: true,
      sessionState: 'idle',
      loggerReady: true,
      credentialStorage: 'available',
      credentialConfigured: false,
    });

    const byId = Object.fromEntries(checks.map((check) => [check.id, check.status]));
    expect(byId.preload).toBe('pass');
    expect(byId.nodeIntegration).toBe('pass');
    expect(byId.ipc).toBe('pass');
    expect(byId.credentials).toBe('not_configured');
    expect(byId.stt).toBe('not_configured');
  });

  it('marks isolation checks as not_tested without client report', () => {
    const checks = buildFoundationChecks({
      configLoaded: true,
      sessionState: 'idle',
      loggerReady: false,
      credentialStorage: 'unavailable',
      credentialConfigured: false,
    });
    const byId = Object.fromEntries(checks.map((check) => [check.id, check.status]));
    expect(byId.preload).toBe('not_tested');
    expect(byId.credentials).toBe('unavailable');
    expect(byId.logger).toBe('not_tested');
  });
});
