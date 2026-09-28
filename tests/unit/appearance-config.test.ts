import { describe, expect, it } from 'vitest';
import { parsePublicConfig } from '../../src/core/configuration/schema';
import {
  DEFAULT_APPEARANCE_PUBLIC_CONFIG,
  DEFAULT_PUBLIC_CONFIG,
} from '../../src/shared/config/types';

describe('appearance / transparency config', () => {
  it('defaults to transparency on, balanced clarity, medium intensity, high blur', () => {
    expect(DEFAULT_PUBLIC_CONFIG.appearance).toEqual(DEFAULT_APPEARANCE_PUBLIC_CONFIG);
    expect(DEFAULT_APPEARANCE_PUBLIC_CONFIG.transparencyEnabled).toBe(true);
    expect(DEFAULT_APPEARANCE_PUBLIC_CONFIG.contentClarity).toBe('balanced');
    expect(DEFAULT_APPEARANCE_PUBLIC_CONFIG.intensity).toBe('medium');
    expect(DEFAULT_APPEARANCE_PUBLIC_CONFIG.blur).toBe('high');
  });

  it('merges appearance into legacy configs without appearance field', () => {
    const { appearance: _omit, ...legacy } = DEFAULT_PUBLIC_CONFIG;
    const parsed = parsePublicConfig(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.appearance.transparencyEnabled).toBe(true);
      expect(parsed.data.appearance.intensity).toBe('medium');
      expect(parsed.data.appearance.contentClarity).toBe('balanced');
    }
  });

  it('fills contentClarity when omitted from older appearance objects', () => {
    const parsed = parsePublicConfig({
      ...DEFAULT_PUBLIC_CONFIG,
      appearance: {
        transparencyEnabled: true,
        intensity: 'subtle',
        blur: 'medium',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.appearance.contentClarity).toBe('balanced');
      expect(parsed.data.appearance.intensity).toBe('subtle');
    }
  });

  it('accepts appearance updates including contentClarity', () => {
    const parsed = parsePublicConfig({
      ...DEFAULT_PUBLIC_CONFIG,
      appearance: {
        transparencyEnabled: false,
        intensity: 'strong',
        blur: 'low',
        contentClarity: 'focused',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.appearance.transparencyEnabled).toBe(false);
      expect(parsed.data.appearance.intensity).toBe('strong');
      expect(parsed.data.appearance.blur).toBe('low');
      expect(parsed.data.appearance.contentClarity).toBe('focused');
    }
  });

  it('accepts glass and focused clarity modes', () => {
    for (const contentClarity of ['glass', 'focused'] as const) {
      const parsed = parsePublicConfig({
        ...DEFAULT_PUBLIC_CONFIG,
        appearance: {
          ...DEFAULT_APPEARANCE_PUBLIC_CONFIG,
          contentClarity,
        },
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.appearance.contentClarity).toBe(contentClarity);
      }
    }
  });
});
