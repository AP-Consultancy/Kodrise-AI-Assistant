import { app, BrowserWindow } from 'electron';
import os from 'node:os';
import type {
  CaptureCapabilities,
  CaptureDiagnosticEntry,
  CapturePlatformId,
  CapabilitySupport,
  LinuxDisplayServer,
} from '../../shared/capture-policy/types';
import type { CaptureCapabilityProvider } from '../../core/capture-policy/CapturePolicyService';
import { createDefaultIdGenerator } from '../../shared/session/types';

/**
 * Detects documented Electron/OS capture-protection capabilities.
 * Uses BrowserWindow.setContentProtection only (Electron 36+).
 */
export class ElectronCaptureCapabilityProvider implements CaptureCapabilityProvider {
  private readonly createId = createDefaultIdGenerator();

  detectCapabilities(): CaptureCapabilities {
    const platform = mapPlatform(process.platform);
    const electronVersion = process.versions.electron ?? app.getVersion();
    const osRelease = `${os.type()} ${os.release()}`;
    const linuxDisplayServer = detectLinuxDisplayServer(platform);
    const apiAvailable = typeof BrowserWindow.prototype.setContentProtection === 'function';

    const notes: string[] = [];
    let windowCaptureProtection: CapabilitySupport = 'UNSUPPORTED';
    let displayCaptureProtection: CapabilitySupport = 'UNSUPPORTED';
    let applicationCaptureProtection: CapabilitySupport = 'UNSUPPORTED';
    let localRecordingProtection: CapabilitySupport = 'UNSUPPORTED';
    let platformSupported: CapabilitySupport = 'UNSUPPORTED';
    let electronCapabilityAvailable: CapabilitySupport = apiAvailable ? 'SUPPORTED' : 'UNSUPPORTED';

    if (!apiAvailable) {
      notes.push('BrowserWindow.setContentProtection is unavailable in this Electron build.');
      electronCapabilityAvailable = 'UNSUPPORTED';
    } else if (platform === 'windows') {
      // Electron maps to SetWindowDisplayAffinity on Windows (Win10 2004+ for exclude-from-capture).
      windowCaptureProtection = 'SUPPORTED';
      displayCaptureProtection = 'PARTIAL';
      applicationCaptureProtection = 'PARTIAL';
      localRecordingProtection = 'PARTIAL';
      platformSupported = 'PARTIAL';
      notes.push(
        'Windows: setContentProtection uses documented OS window affinity. Some full-display and third-party capture paths may still include the window.',
      );
      notes.push('Effective OS support typically requires Windows 10 version 2004 or later for exclude-from-capture affinity.');
    } else if (platform === 'macos') {
      windowCaptureProtection = 'PARTIAL';
      displayCaptureProtection = 'PARTIAL';
      applicationCaptureProtection = 'UNKNOWN';
      localRecordingProtection = 'PARTIAL';
      platformSupported = 'PARTIAL';
      notes.push(
        'macOS: setContentProtection is available; observed effectiveness varies by capture API and OS version.',
      );
    } else if (platform === 'linux') {
      windowCaptureProtection = 'UNSUPPORTED';
      displayCaptureProtection = 'UNSUPPORTED';
      applicationCaptureProtection = 'UNSUPPORTED';
      localRecordingProtection = 'UNSUPPORTED';
      platformSupported = 'UNSUPPORTED';
      electronCapabilityAvailable = apiAvailable ? 'PARTIAL' : 'UNSUPPORTED';
      notes.push(
        `Linux (${linuxDisplayServer}): no equivalent documented OS capture-exclusion guarantee via Electron setContentProtection.`,
      );
    } else {
      windowCaptureProtection = 'UNKNOWN';
      displayCaptureProtection = 'UNKNOWN';
      applicationCaptureProtection = 'UNKNOWN';
      localRecordingProtection = 'UNKNOWN';
      platformSupported = 'UNKNOWN';
      notes.push('Unknown platform — capability status cannot be determined.');
    }

    return {
      platform,
      electronVersion,
      osRelease,
      linuxDisplayServer,
      windowCaptureProtection,
      displayCaptureProtection,
      applicationCaptureProtection,
      localRecordingProtection,
      platformSupported,
      electronCapabilityAvailable,
      requiresOSSupport: true,
      requiresRestart: false,
      requiresAdditionalPermission: false,
      notes,
    };
  }

  applyContentProtection(enabled: boolean): {
    enabled: boolean;
    support: CapabilitySupport;
    diagnostics: CaptureDiagnosticEntry[];
  } {
    const diagnostics: CaptureDiagnosticEntry[] = [];
    const capabilities = this.detectCapabilities();
    const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());

    if (typeof BrowserWindow.prototype.setContentProtection !== 'function') {
      diagnostics.push(
        this.diag('error', 'capture.api.missing', 'setContentProtection API is not available'),
      );
      return { enabled: false, support: 'UNSUPPORTED', diagnostics };
    }

    if (capabilities.windowCaptureProtection === 'UNSUPPORTED' && enabled) {
      diagnostics.push(
        this.diag(
          'warn',
          'capture.apply.skipped',
          'Skipping content protection enable — platform reports UNSUPPORTED',
          { platform: capabilities.platform },
        ),
      );
      return { enabled: false, support: 'UNSUPPORTED', diagnostics };
    }

    let applied = 0;
    let failed = 0;
    for (const win of windows) {
      try {
        win.setContentProtection(enabled);
        applied += 1;
      } catch (error) {
        failed += 1;
        diagnostics.push(
          this.diag('error', 'capture.apply.window_failed', 'Failed to set content protection on window', {
            message: error instanceof Error ? error.message : 'unknown',
          }),
        );
      }
    }

    diagnostics.push(
      this.diag('info', 'capture.apply.result', 'Content protection apply finished', {
        enabled,
        applied,
        failed,
        windowCount: windows.length,
      }),
    );

    if (failed > 0 && applied === 0) {
      return { enabled: false, support: 'ERROR', diagnostics };
    }

    const support =
      capabilities.windowCaptureProtection === 'SUPPORTED'
        ? 'SUPPORTED'
        : capabilities.windowCaptureProtection === 'PARTIAL'
          ? 'PARTIAL'
          : enabled
            ? 'PARTIAL'
            : 'SUPPORTED';

    return { enabled: enabled && applied > 0, support, diagnostics };
  }

  getWindowCount(): number {
    return BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed()).length;
  }

  getFocusedWindowId(): number | null {
    const focused = BrowserWindow.getFocusedWindow();
    return focused && !focused.isDestroyed() ? focused.id : null;
  }

  private diag(
    level: CaptureDiagnosticEntry['level'],
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): CaptureDiagnosticEntry {
    return {
      id: this.createId(),
      timestamp: Date.now(),
      level,
      code,
      message,
      details,
    };
  }
}

function mapPlatform(platform: NodeJS.Platform): CapturePlatformId {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'unknown';
}

function detectLinuxDisplayServer(platform: CapturePlatformId): LinuxDisplayServer {
  if (platform !== 'linux') return 'not_applicable';
  if (process.env.WAYLAND_DISPLAY) return 'wayland';
  if (process.env.DISPLAY) return 'x11';
  return 'unknown';
}
