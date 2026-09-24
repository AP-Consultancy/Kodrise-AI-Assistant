import { describe, expect, it } from 'vitest';
import {
  CapturePolicyService,
  type CaptureCapabilityProvider,
} from '../../src/core/capture-policy/CapturePolicyService';
import type {
  CaptureCapabilities,
  CaptureDiagnosticEntry,
  CapabilitySupport,
} from '../../src/shared/capture-policy/types';
import { CaptureApplyPolicySchema } from '../../src/shared/ipc/schemas';
import { toSafeErrorPayload, ValidationError } from '../../src/shared/errors';

function caps(overrides: Partial<CaptureCapabilities> = {}): CaptureCapabilities {
  return {
    platform: 'windows',
    electronVersion: '36.4.0',
    osRelease: 'Windows 10',
    linuxDisplayServer: 'not_applicable',
    windowCaptureProtection: 'SUPPORTED',
    displayCaptureProtection: 'PARTIAL',
    applicationCaptureProtection: 'PARTIAL',
    localRecordingProtection: 'PARTIAL',
    platformSupported: 'PARTIAL',
    electronCapabilityAvailable: 'SUPPORTED',
    requiresOSSupport: true,
    requiresRestart: false,
    requiresAdditionalPermission: false,
    notes: ['test note'],
    ...overrides,
  };
}

function mockProvider(
  capabilities: CaptureCapabilities,
  applyResult?: {
    enabled: boolean;
    support: CapabilitySupport;
    diagnostics?: CaptureDiagnosticEntry[];
  },
): CaptureCapabilityProvider {
  return {
    detectCapabilities: () => structuredClone(capabilities),
    applyContentProtection: (enabled) =>
      applyResult ?? {
        enabled,
        support: capabilities.windowCaptureProtection,
        diagnostics: [],
      },
    getWindowCount: () => 1,
    getFocusedWindowId: () => 1,
  };
}

describe('CapturePolicyService', () => {
  it('detects platform capabilities from provider', () => {
    const service = new CapturePolicyService({
      provider: mockProvider(caps({ platform: 'macos', windowCaptureProtection: 'PARTIAL' })),
    });
    expect(service.getPlatform()).toBe('macos');
    expect(service.getCapabilities().windowCaptureProtection).toBe('PARTIAL');
  });

  it('applies STANDARD without enabling content protection', () => {
    const service = new CapturePolicyService({
      provider: mockProvider(caps()),
      initialPolicy: 'PRIVACY_AWARE',
    });
    const result = service.applyPolicy('STANDARD');
    expect(result.success).toBe(true);
    expect(result.contentProtectionEnabled).toBe(false);
    expect(service.getPolicy()).toBe('STANDARD');
  });

  it('applies PRIVACY_AWARE when supported', () => {
    const service = new CapturePolicyService({
      provider: mockProvider(caps(), {
        enabled: true,
        support: 'PARTIAL',
        diagnostics: [],
      }),
    });
    const result = service.applyPolicy('PRIVACY_AWARE');
    expect(result.success).toBe(true);
    expect(result.contentProtectionEnabled).toBe(true);
    expect(result.status).toBe('PARTIAL');
  });

  it('refuses PRIVACY_AWARE on unsupported platforms', () => {
    const service = new CapturePolicyService({
      provider: mockProvider(
        caps({
          platform: 'linux',
          windowCaptureProtection: 'UNSUPPORTED',
          electronCapabilityAvailable: 'UNSUPPORTED',
          platformSupported: 'UNSUPPORTED',
        }),
      ),
    });
    const result = service.applyPolicy('PRIVACY_AWARE');
    expect(result.success).toBe(false);
    expect(result.status).toBe('UNSUPPORTED');
    expect(result.contentProtectionEnabled).toBe(false);
  });

  it('handles DISABLED policy', () => {
    const service = new CapturePolicyService({
      provider: mockProvider(caps()),
    });
    const result = service.applyPolicy('DISABLED');
    expect(result.success).toBe(true);
    expect(result.contentProtectionEnabled).toBe(false);
    expect(service.getPolicy()).toBe('DISABLED');
  });

  it('rejects invalid policy', () => {
    const service = new CapturePolicyService({ provider: mockProvider(caps()) });
    expect(() => service.applyPolicy('STEALTH')).toThrow(ValidationError);
  });

  it('resets to STANDARD', () => {
    const service = new CapturePolicyService({
      provider: mockProvider(caps()),
      initialPolicy: 'DISABLED',
    });
    const result = service.resetPolicy();
    expect(result.policy).toBe('STANDARD');
  });

  it('reports apply failure when provider cannot enable protection', () => {
    const service = new CapturePolicyService({
      provider: mockProvider(caps(), {
        enabled: false,
        support: 'ERROR',
        diagnostics: [],
      }),
    });
    const result = service.applyPolicy('PRIVACY_AWARE');
    expect(result.success).toBe(false);
    expect(result.status).toBe('ERROR');
  });

  it('builds harness snapshot with warning', () => {
    const service = new CapturePolicyService({ provider: mockProvider(caps()) });
    const harness = service.getHarnessSnapshot();
    expect(harness.windowCount).toBe(1);
    expect(harness.warning).toMatch(/not the same/i);
  });
});

describe('Capture IPC contracts', () => {
  it('validates apply policy payload', () => {
    expect(CaptureApplyPolicySchema.safeParse({ policy: 'PRIVACY_AWARE' }).success).toBe(true);
    expect(CaptureApplyPolicySchema.safeParse({ policy: 'hidden' }).success).toBe(false);
  });

  it('maps validation errors safely', () => {
    const payload = toSafeErrorPayload(new ValidationError('Invalid capture policy payload'));
    expect(payload.code).toBe('VALIDATION');
    expect(JSON.stringify(payload)).not.toMatch(/apiKey|secret/i);
  });
});
