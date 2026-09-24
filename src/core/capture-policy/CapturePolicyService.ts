import type {
  CaptureCapabilities,
  CaptureDiagnosticEntry,
  CapturePolicyApplyResult,
  CapturePolicyEvent,
  CapturePolicyId,
  CapturePolicyStatus,
  CapabilitySupport,
} from '../../shared/capture-policy/types';
import {
  CAPTURE_POLICY_LIMITATIONS,
  DEFAULT_CAPTURE_POLICY,
} from '../../shared/capture-policy/types';
import { ValidationError } from '../../shared/errors';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';

export interface CaptureCapabilityProvider {
  detectCapabilities(): CaptureCapabilities;
  /**
   * Apply or clear documented window content protection on managed windows.
   * Returns whether content protection is enabled after the call.
   */
  applyContentProtection(enabled: boolean): {
    enabled: boolean;
    support: CapabilitySupport;
    diagnostics: CaptureDiagnosticEntry[];
  };
  getWindowCount(): number;
  getFocusedWindowId(): number | null;
}

export type CapturePolicyListener = (event: CapturePolicyEvent) => void;

export interface CapturePolicyServiceOptions {
  provider: CaptureCapabilityProvider;
  idGenerator?: IdGenerator;
  initialPolicy?: CapturePolicyId;
  onLog?: (event: string, meta: Record<string, unknown>) => void;
  maxDiagnostics?: number;
}

const VALID_POLICIES: CapturePolicyId[] = ['STANDARD', 'PRIVACY_AWARE', 'DISABLED'];

/**
 * Platform-independent capture policy coordinator.
 * Does not import Electron; depends on an injected capability provider.
 */
export class CapturePolicyService {
  private policy: CapturePolicyId;
  private contentProtectionEnabled = false;
  private overallStatus: CapabilitySupport = 'NOT_CONFIGURED';
  private lastAppliedAt: number | null = null;
  private lastErrorCode: string | null = null;
  private diagnostics: CaptureDiagnosticEntry[] = [];
  private capabilities: CaptureCapabilities;
  private readonly provider: CaptureCapabilityProvider;
  private readonly createId: IdGenerator;
  private readonly onLog: (event: string, meta: Record<string, unknown>) => void;
  private readonly maxDiagnostics: number;
  private readonly listeners = new Set<CapturePolicyListener>();

  constructor(options: CapturePolicyServiceOptions) {
    this.provider = options.provider;
    this.createId = options.idGenerator ?? createDefaultIdGenerator();
    this.onLog = options.onLog ?? (() => undefined);
    this.maxDiagnostics = options.maxDiagnostics ?? 40;
    this.policy = options.initialPolicy ?? DEFAULT_CAPTURE_POLICY;
    this.capabilities = this.provider.detectCapabilities();
    this.pushDiagnostic('info', 'capture.capabilities.detected', 'Initial capability probe completed', {
      platform: this.capabilities.platform,
      electronVersion: this.capabilities.electronVersion,
    });
  }

  subscribe(listener: CapturePolicyListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPlatform() {
    return this.capabilities.platform;
  }

  getCapabilities(): CaptureCapabilities {
    this.capabilities = this.provider.detectCapabilities();
    return structuredClone(this.capabilities);
  }

  getPolicy(): CapturePolicyId {
    return this.policy;
  }

  getStatus(): CapturePolicyStatus {
    return {
      platform: this.capabilities.platform,
      electronVersion: this.capabilities.electronVersion,
      policy: this.policy,
      overallStatus: this.overallStatus,
      contentProtectionEnabled: this.contentProtectionEnabled,
      capabilities: structuredClone(this.capabilities),
      diagnostics: this.diagnostics.map((item) => structuredClone(item)),
      lastAppliedAt: this.lastAppliedAt,
      lastErrorCode: this.lastErrorCode,
      limitations: [...CAPTURE_POLICY_LIMITATIONS, ...this.capabilities.notes],
    };
  }

  refreshCapabilities(): CaptureCapabilities {
    const previous = this.capabilities.electronCapabilityAvailable;
    this.capabilities = this.provider.detectCapabilities();
    if (previous !== this.capabilities.electronCapabilityAvailable) {
      this.emit({
        type: 'capture.capability.changed',
        timestamp: Date.now(),
        policy: this.policy,
        status: this.overallStatus,
        contentProtectionEnabled: this.contentProtectionEnabled,
        message: 'Capability probe updated',
      });
    }
    return this.getCapabilities();
  }

  applyPolicy(policy: unknown): CapturePolicyApplyResult {
    const next = this.parsePolicy(policy);
    this.capabilities = this.provider.detectCapabilities();

    if (next === 'PRIVACY_AWARE') {
      if (
        this.capabilities.electronCapabilityAvailable === 'UNSUPPORTED' ||
        this.capabilities.windowCaptureProtection === 'UNSUPPORTED'
      ) {
        this.policy = next;
        this.contentProtectionEnabled = false;
        this.overallStatus = 'UNSUPPORTED';
        this.lastErrorCode = 'UNSUPPORTED_PLATFORM';
        this.lastAppliedAt = Date.now();
        const diagnostic = this.pushDiagnostic(
          'warn',
          'capture.policy.unsupported',
          'PRIVACY_AWARE requested but documented window capture protection is unsupported on this platform',
          { platform: this.capabilities.platform },
        );
        const result: CapturePolicyApplyResult = {
          success: false,
          policy: next,
          status: 'UNSUPPORTED',
          contentProtectionEnabled: false,
          capabilities: structuredClone(this.capabilities),
          diagnostics: [diagnostic],
          message: 'Documented capture protection is unsupported on this platform',
        };
        this.emitChange(result.message);
        return result;
      }

      const applied = this.provider.applyContentProtection(true);
      this.mergeDiagnostics(applied.diagnostics);
      this.policy = next;
      this.contentProtectionEnabled = applied.enabled;
      this.overallStatus = this.resolveOverall(applied.support);
      this.lastAppliedAt = Date.now();
      this.lastErrorCode = applied.enabled ? null : 'APPLY_FAILED';
      const success = applied.enabled;
      const message = success
        ? `PRIVACY_AWARE applied (${this.overallStatus})`
        : 'Failed to enable documented content protection';
      if (!success) {
        this.pushDiagnostic('error', 'capture.policy.apply_failed', message, {});
      } else {
        this.pushDiagnostic('info', 'capture.policy.applied', message, {
          status: this.overallStatus,
        });
      }
      const result: CapturePolicyApplyResult = {
        success,
        policy: next,
        status: this.overallStatus,
        contentProtectionEnabled: this.contentProtectionEnabled,
        capabilities: structuredClone(this.capabilities),
        diagnostics: this.diagnostics.slice(-5),
        message,
      };
      this.emitChange(message);
      return result;
    }

    // STANDARD or DISABLED → clear protection
    const applied = this.provider.applyContentProtection(false);
    this.mergeDiagnostics(applied.diagnostics);
    this.policy = next;
    this.contentProtectionEnabled = false;
    this.overallStatus = next === 'DISABLED' ? 'NOT_CONFIGURED' : 'SUPPORTED';
    this.lastAppliedAt = Date.now();
    this.lastErrorCode = null;
    const message =
      next === 'DISABLED'
        ? 'Capture protection disabled by policy'
        : 'STANDARD policy active (no content protection)';
    this.pushDiagnostic('info', 'capture.policy.applied', message, { policy: next });
    const result: CapturePolicyApplyResult = {
      success: true,
      policy: next,
      status: this.overallStatus,
      contentProtectionEnabled: false,
      capabilities: structuredClone(this.capabilities),
      diagnostics: this.diagnostics.slice(-5),
      message,
    };
    this.emitChange(message);
    return result;
  }

  resetPolicy(): CapturePolicyApplyResult {
    return this.applyPolicy(DEFAULT_CAPTURE_POLICY);
  }

  getHarnessSnapshot(): {
    platform: CapturePolicyStatus['platform'];
    electronVersion: string;
    osRelease: string;
    linuxDisplayServer: CaptureCapabilities['linuxDisplayServer'];
    windowCount: number;
    focusedWindowId: number | null;
    policy: CapturePolicyId;
    capabilities: CaptureCapabilities;
    status: CapturePolicyStatus;
    warning: string;
  } {
    const status = this.getStatus();
    return {
      platform: status.platform,
      electronVersion: status.electronVersion,
      osRelease: this.capabilities.osRelease,
      linuxDisplayServer: this.capabilities.linuxDisplayServer,
      windowCount: this.provider.getWindowCount(),
      focusedWindowId: this.provider.getFocusedWindowId(),
      policy: status.policy,
      capabilities: status.capabilities,
      status,
      warning:
        'Development harness only. Successful API configuration is not the same as third-party capture applications respecting OS-level protection.',
    };
  }

  private parsePolicy(policy: unknown): CapturePolicyId {
    if (typeof policy !== 'string' || !VALID_POLICIES.includes(policy as CapturePolicyId)) {
      throw new ValidationError('Invalid capture policy', { policy });
    }
    return policy as CapturePolicyId;
  }

  private resolveOverall(support: CapabilitySupport): CapabilitySupport {
    if (support === 'SUPPORTED' || support === 'PARTIAL') {
      // Prefer PARTIAL when platform notes indicate incomplete coverage.
      if (
        this.capabilities.displayCaptureProtection === 'PARTIAL' ||
        this.capabilities.localRecordingProtection === 'PARTIAL' ||
        this.capabilities.windowCaptureProtection === 'PARTIAL'
      ) {
        return 'PARTIAL';
      }
      return support;
    }
    return support;
  }

  private emitChange(message: string): void {
    this.onLog('capture.policy.changed', {
      policy: this.policy,
      status: this.overallStatus,
      contentProtectionEnabled: this.contentProtectionEnabled,
    });
    this.emit({
      type: 'capture.policy.changed',
      timestamp: Date.now(),
      policy: this.policy,
      status: this.overallStatus,
      contentProtectionEnabled: this.contentProtectionEnabled,
      message,
    });
    this.emit({
      type: 'capture.diagnostic.updated',
      timestamp: Date.now(),
      policy: this.policy,
      status: this.overallStatus,
      contentProtectionEnabled: this.contentProtectionEnabled,
    });
  }

  private emit(event: CapturePolicyEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private pushDiagnostic(
    level: CaptureDiagnosticEntry['level'],
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): CaptureDiagnosticEntry {
    const entry: CaptureDiagnosticEntry = {
      id: this.createId(),
      timestamp: Date.now(),
      level,
      code,
      message,
      details,
    };
    this.diagnostics.push(entry);
    while (this.diagnostics.length > this.maxDiagnostics) {
      this.diagnostics.shift();
    }
    return entry;
  }

  private mergeDiagnostics(entries: CaptureDiagnosticEntry[]): void {
    for (const entry of entries) {
      this.diagnostics.push(entry);
    }
    while (this.diagnostics.length > this.maxDiagnostics) {
      this.diagnostics.shift();
    }
  }
}
