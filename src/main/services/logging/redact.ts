const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|token|password|secret|authorization|credential|cookie|session[_-]?id|data[_-]?base64|audio[_-]?data|pcm|raw[_-]?audio|transcript[_-]?text|full[_-]?transcript)/i;

const REDACTED = '[REDACTED]';

export function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return REDACTED;
  }

  if (typeof value === 'string') {
    if (value.length > 256 && /data:image\//i.test(value)) {
      return '[REDACTED_IMAGE]';
    }
    if (/Bearer\s+[A-Za-z0-9\-._~+/]+=*/i.test(value)) {
      return value.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]');
    }
  }

  return value;
}

export function redactMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = redactMeta(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      output[key] = value.map((item, index) => redactValue(String(index), item));
    } else {
      output[key] = redactValue(key, value);
    }
  }
  return output;
}

export { REDACTED };
