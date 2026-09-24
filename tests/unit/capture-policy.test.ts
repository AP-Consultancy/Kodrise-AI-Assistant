import { describe, expect, it, vi } from 'vitest';
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
import {
  CAPTURE_POLICY_OPTIONS,
  DEFAULT_CAPTURE_POLICY,
} from '../../src/shared/capture-policy/types';

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

  it('maps STANDARD → applyContentProtection(false)', () => {
    const calls: boolean[] = [];
    const provider = mockProvider(caps());
    provider.applyContentProtection = (enabled) => {
      calls.push(enabled);
      return { enabled: false, support: 'SUPPORTED', diagnostics: [] };
    };
    const service = new CapturePolicyService({
      provider,
      initialPolicy: 'PRIVACY_AWARE',
    });
    const result = service.applyPolicy('STANDARD');
    expect(calls).toEqual([false]);
    expect(result.success).toBe(true);
    expect(result.contentProtectionEnabled).toBe(false);
    expect(service.getPolicy()).toBe('STANDARD');
  });

  it('maps DISABLED → applyContentProtection(false)', () => {
    const calls: boolean[] = [];
    const provider = mockProvider(caps());
    provider.applyContentProtection = (enabled) => {
      calls.push(enabled);
      return { enabled: false, support: 'SUPPORTED', diagnostics: [] };
    };
    const service = new CapturePolicyService({ provider });
    const result = service.applyPolicy('DISABLED');
    expect(calls).toEqual([false]);
    expect(result.success).toBe(true);
    expect(result.contentProtectionEnabled).toBe(false);
    expect(service.getPolicy()).toBe('DISABLED');
  });

  it('maps PRIVACY_AWARE → applyContentProtection(true)', () => {
    const calls: boolean[] = [];
    const provider = mockProvider(caps());
    provider.applyContentProtection = (enabled) => {
      calls.push(enabled);
      return { enabled: true, support: 'PARTIAL', diagnostics: [] };
    };
    const service = new CapturePolicyService({ provider });
    const result = service.applyPolicy('PRIVACY_AWARE');
    expect(calls).toEqual([true]);
    expect(result.success).toBe(true);
    expect(result.contentProtectionEnabled).toBe(true);
    expect(result.status).toBe('PARTIAL');
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
    const calls: boolean[] = [];
    const provider = mockProvider(
      caps({
        platform: 'linux',
        windowCaptureProtection: 'UNSUPPORTED',
        electronCapabilityAvailable: 'UNSUPPORTED',
        platformSupported: 'UNSUPPORTED',
      }),
    );
    provider.applyContentProtection = (enabled) => {
      calls.push(enabled);
      return { enabled: false, support: 'UNSUPPORTED', diagnostics: [] };
    };
    const service = new CapturePolicyService({ provider });
    const result = service.applyPolicy('PRIVACY_AWARE');
    expect(calls).toEqual([]);
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

describe('Window Capture Protection labels', () => {
  it('exposes the three policies with clear Settings copy', () => {
    expect(DEFAULT_CAPTURE_POLICY).toBe('STANDARD');
    expect(CAPTURE_POLICY_OPTIONS.map((o) => o.id)).toEqual([
      'STANDARD',
      'PRIVACY_AWARE',
      'DISABLED',
    ]);
    expect(CAPTURE_POLICY_OPTIONS[0]?.description).toMatch(/normal screen capture/i);
    expect(CAPTURE_POLICY_OPTIONS[1]?.description).toMatch(/OS-level capture protection/i);
    expect(CAPTURE_POLICY_OPTIONS[2]?.description).toMatch(/No capture protection/i);
  });
});

describe('ElectronCaptureCapabilityProvider content protection mapping', () => {
  it('calls BrowserWindow.setContentProtection(true|false) for enable/disable', async () => {
    const setContentProtection = vi.fn();
    vi.resetModules();
    vi.doMock('electron', () => ({
      app: { getVersion: () => '36.4.0' },
      BrowserWindow: {
        prototype: { setContentProtection },
        getAllWindows: () => [
          {
            isDestroyed: () => false,
            setContentProtection,
          },
        ],
        getFocusedWindow: () => null,
      },
    }));

    const { ElectronCaptureCapabilityProvider } = await import(
      '../../src/main/capture/ElectronCaptureCapabilityProvider'
    );
    const provider = new ElectronCaptureCapabilityProvider();

    const on = provider.applyContentProtection(true);
    expect(setContentProtection).toHaveBeenCalledWith(true);
    expect(on.enabled).toBe(true);

    const off = provider.applyContentProtection(false);
    expect(setContentProtection).toHaveBeenCalledWith(false);
    expect(off.enabled).toBe(false);

    vi.doUnmock('electron');
  });
});
