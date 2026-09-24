import { describe, expect, it } from 'vitest';
import { CredentialsKeySchema, CredentialsSetSchema } from '../../src/shared/ipc/schemas';
import { toSafeErrorPayload, ValidationError } from '../../src/shared/errors';
import { PublicConfigUpdateSchema } from '../../src/core/configuration/schema';
import { ConfigurationService } from '../../src/core/configuration/ConfigurationService';

/**
 * Simulates the main handler path: validate payload → invoke domain service → envelope.
 */
async function invokeConfigUpdate(payload: unknown) {
  const parsed = PublicConfigUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: toSafeErrorPayload(new ValidationError('Invalid config update payload')),
    };
  }
  const service = new ConfigurationService();
  try {
    const data = service.update(parsed.data);
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, error: toSafeErrorPayload(error) };
  }
}

describe('IPC handler path simulation', () => {
  it('valid request → handler → response', async () => {
    const result = await invokeConfigUpdate({ theme: 'dark' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.theme).toBe('dark');
    }
  });

  it('invalid IPC payload → validation failure', async () => {
    const result = await invokeConfigUpdate({ language: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('VALIDATION');
    }
  });

  it('credential set schema rejects incomplete payloads', () => {
    expect(CredentialsSetSchema.safeParse({ key: 'k' }).success).toBe(false);
    expect(CredentialsKeySchema.safeParse({ key: 'k' }).success).toBe(true);
  });
});
