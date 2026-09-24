import { describe, expect, it } from 'vitest';
import { redactMeta, REDACTED } from '../../src/main/services/logging/redact';

describe('logger redaction', () => {
  it('redacts sensitive fields', () => {
    const redacted = redactMeta({
      apiKey: 'abcd',
      token: 'xyz',
      password: 'secret',
      nested: { authorization: 'Bearer 123', safe: 'ok' },
      note: 'hello',
    });

    expect(redacted).toEqual({
      apiKey: REDACTED,
      token: REDACTED,
      password: REDACTED,
      nested: { authorization: REDACTED, safe: 'ok' },
      note: 'hello',
    });
  });
});
