import { BrowserWindow } from 'electron';
import type { CapturePolicyId } from '../../shared/capture-policy/types';
import type {
  CaptureHarnessSnapshot,
  CapturePolicyApplyResult,
  CapturePolicyEvent,
  CapturePolicyStatus,
  CaptureCapabilities,
} from '../../shared/capture-policy/types';
import { CapturePolicyService } from '../../core/capture-policy/CapturePolicyService';
import { ElectronCaptureCapabilityProvider } from './ElectronCaptureCapabilityProvider';
import { IpcEvents } from '../../shared/ipc/channels';
import { logger } from '../services/logging';

export interface CapturePolicyHostOptions {
  getInitialPolicy?: () => CapturePolicyId;
  persistPolicy?: (policy: CapturePolicyId) => void;
}

/**
 * Main-process host for capture privacy policy.
 * Applies policy to BrowserWindows after creation and on policy changes.
 */
export class CapturePolicyHost {
  private readonly service: CapturePolicyService;
  private readonly persistPolicy: ((policy: CapturePolicyId) => void) | null;
  private unsubscribers: Array<() => void> = [];

  constructor(options: CapturePolicyHostOptions = {}) {
    const provider = new ElectronCaptureCapabilityProvider();
    this.persistPolicy = options.persistPolicy ?? null;
    this.service = new CapturePolicyService({
      provider,
      initialPolicy: options.getInitialPolicy?.() ?? 'STANDARD',
      onLog: (event, meta) => logger.info(event, meta),
    });

    this.unsubscribers.push(
      this.service.subscribe((event: CapturePolicyEvent) => {
        this.broadcast(event);
      }),
    );

    // Re-apply configured policy so windows created later inherit protection state.
    const initial = this.service.getPolicy();
    this.service.applyPolicy(initial);
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }

  /** Call after each BrowserWindow is created. */
  onWindowCreated(_window: BrowserWindow): void {
    const policy = this.service.getPolicy();
    this.service.applyPolicy(policy);
  }

  getPlatform() {
    return this.service.getPlatform();
  }

  getCapabilities(): CaptureCapabilities {
    return this.service.getCapabilities();
  }

  getStatus(): CapturePolicyStatus {
    return this.service.getStatus();
  }

  getPolicy(): CapturePolicyId {
    return this.service.getPolicy();
  }

  applyPolicy(policy: CapturePolicyId): CapturePolicyApplyResult {
    const result = this.service.applyPolicy(policy);
    if (result.success || policy === 'PRIVACY_AWARE') {
      this.persistPolicy?.(result.policy);
    }
    return result;
  }

  resetPolicy(): CapturePolicyApplyResult {
    const result = this.service.resetPolicy();
    this.persistPolicy?.(result.policy);
    return result;
  }

  getHarnessSnapshot(): CaptureHarnessSnapshot {
    return this.service.getHarnessSnapshot();
  }

  private broadcast(payload: CapturePolicyEvent): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IpcEvents.CAPTURE_POLICY_CHANGED, payload);
        if (payload.type === 'capture.diagnostic.updated') {
          window.webContents.send(IpcEvents.CAPTURE_DIAGNOSTIC_UPDATED, payload);
        }
        if (payload.type === 'capture.capability.changed') {
          window.webContents.send(IpcEvents.CAPTURE_CAPABILITY_CHANGED, payload);
        }
      }
    }
  }
}
