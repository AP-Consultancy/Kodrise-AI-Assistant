export type CapturePlatformId = 'windows' | 'macos' | 'linux' | 'unknown';

export type CapturePolicyId = 'STANDARD' | 'PRIVACY_AWARE' | 'DISABLED';

export type CapabilitySupport =
  | 'SUPPORTED'
  | 'PARTIAL'
  | 'UNSUPPORTED'
  | 'UNKNOWN'
  | 'NOT_CONFIGURED'
  | 'ERROR';

export type LinuxDisplayServer = 'x11' | 'wayland' | 'unknown' | 'not_applicable';

export interface CaptureCapabilities {
  platform: CapturePlatformId;
  electronVersion: string;
  osRelease: string;
  linuxDisplayServer: LinuxDisplayServer;
  windowCaptureProtection: CapabilitySupport;
  displayCaptureProtection: CapabilitySupport;
  applicationCaptureProtection: CapabilitySupport;
  localRecordingProtection: CapabilitySupport;
  platformSupported: CapabilitySupport;
  electronCapabilityAvailable: CapabilitySupport;
  requiresOSSupport: boolean;
  requiresRestart: boolean;
  requiresAdditionalPermission: boolean;
  notes: string[];
}

export interface CaptureDiagnosticEntry {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CapturePolicyStatus {
  platform: CapturePlatformId;
  electronVersion: string;
  policy: CapturePolicyId;
  overallStatus: CapabilitySupport;
  contentProtectionEnabled: boolean;
  capabilities: CaptureCapabilities;
  diagnostics: CaptureDiagnosticEntry[];
  lastAppliedAt: number | null;
  lastErrorCode: string | null;
  limitations: string[];
}

export interface CapturePolicyApplyResult {
  success: boolean;
  policy: CapturePolicyId;
  status: CapabilitySupport;
  contentProtectionEnabled: boolean;
  capabilities: CaptureCapabilities;
  diagnostics: CaptureDiagnosticEntry[];
  message: string;
}

export type CapturePolicyEventType =
  | 'capture.policy.changed'
  | 'capture.capability.changed'
  | 'capture.diagnostic.updated';

export interface CapturePolicyEvent {
  type: CapturePolicyEventType;
  timestamp: number;
  policy: CapturePolicyId;
  status: CapabilitySupport;
  contentProtectionEnabled: boolean;
  message?: string;
}

export interface CaptureHarnessSnapshot {
  platform: CapturePlatformId;
  electronVersion: string;
  osRelease: string;
  linuxDisplayServer: LinuxDisplayServer;
  windowCount: number;
  focusedWindowId: number | null;
  policy: CapturePolicyId;
  capabilities: CaptureCapabilities;
  status: CapturePolicyStatus;
  warning: string;
}

export const DEFAULT_CAPTURE_POLICY: CapturePolicyId = 'STANDARD';

/** User-facing labels for Settings — maps 1:1 to CapturePolicyId. */
export const CAPTURE_POLICY_OPTIONS: ReadonlyArray<{
  id: CapturePolicyId;
  label: string;
  description: string;
}> = [
  {
    id: 'STANDARD',
    label: 'Standard',
    description: 'Normal screen capture behavior',
  },
  {
    id: 'PRIVACY_AWARE',
    label: 'Privacy Aware',
    description: 'Request OS-level capture protection',
  },
  {
    id: 'DISABLED',
    label: 'Disabled',
    description: 'No capture protection',
  },
] as const;

export const CAPTURE_POLICY_LIMITATIONS = [
  'OS/Electron capture protection applies only to capture paths that honor the documented API.',
  'Configuring the API successfully does not guarantee every third-party recorder will respect it.',
  'Full-display capture, remote desktops, VMs, and external cameras may still include the window.',
] as const;

