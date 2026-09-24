export type VisualSourceKind = 'DISPLAY' | 'WINDOW' | 'REGION' | 'MANUAL_IMAGE' | 'NONE';

export type VisualCapabilitySupport =
  | 'SUPPORTED'
  | 'PARTIAL'
  | 'UNSUPPORTED'
  | 'UNKNOWN'
  | 'NOT_CONFIGURED'
  | 'ERROR';

export type VisualRuntimeState =
  | 'disabled'
  | 'ready'
  | 'capturing'
  | 'paused'
  | 'error';

export type VisualFrameStatus = 'accepted' | 'rejected' | 'evicted';

export type VisualMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface VisualPublicConfig {
  enabled: boolean;
  source: VisualSourceKind;
  maxFrames: number;
  maxImageBytes: number;
  maxWidth: number;
  maxHeight: number;
  /** Minimum ms between auto captures when capturing; 0 = manual only. */
  captureIntervalMs: number;
  maxVisualContextBytes: number;
}

export const DEFAULT_VISUAL_PUBLIC_CONFIG: VisualPublicConfig = {
  enabled: false,
  source: 'NONE',
  maxFrames: 3,
  maxImageBytes: 1_500_000,
  maxWidth: 1280,
  maxHeight: 720,
  captureIntervalMs: 0,
  maxVisualContextBytes: 4_000_000,
};

export interface VisualCaptureCapabilities {
  platform: 'windows' | 'macos' | 'linux' | 'unknown';
  displayCapture: VisualCapabilitySupport;
  windowCapture: VisualCapabilitySupport;
  regionCapture: VisualCapabilitySupport;
  manualImage: VisualCapabilitySupport;
  permissionRequired: boolean;
  permissionGranted: boolean | null;
  maxRecommendedWidth: number;
  maxRecommendedHeight: number;
  maxFrameBytes: number;
  notes: string[];
}

export interface VisualCaptureSource {
  id: string;
  name: string;
  kind: Exclude<VisualSourceKind, 'NONE' | 'MANUAL_IMAGE' | 'REGION'>;
  displayId?: string;
  /** Optional tiny preview as data URL for UI — omit for large payloads. */
  thumbnailDataUrl?: string;
}

export interface VisualRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualCaptureRequest {
  sourceKind: VisualSourceKind;
  sourceId?: string;
  region?: VisualRegion;
  /** Manual image path selected via main-process dialog, or raw bytes from validated IPC. */
  manual?: {
    mimeType: VisualMimeType;
    bytesBase64: string;
    fileName?: string;
  };
}

/** Metadata-only frame reference for IPC/context (no image bytes). */
export interface VisualFrameReference {
  id: string;
  timestamp: number;
  width: number;
  height: number;
  mimeType: VisualMimeType;
  byteSize: number;
  source: VisualSourceKind;
  sourceId: string | null;
  contentHash: string;
  captureDurationMs: number;
  status: VisualFrameStatus;
}

/** Full frame held transiently in main memory only. */
export interface VisualFrame extends VisualFrameReference {
  bytes: Uint8Array;
}

export interface VisualContextMetadata {
  frameCount: number;
  discardedCount: number;
  truncated: boolean;
  approximatePayloadBytes: number;
  source: VisualSourceKind;
  visualFrameCount: number;
  ocrResultCount: number;
  visionAnalysisCount: number;
  discardedFrameCount: number;
  payloadBytes: number;
}

/** Safe OCR summary for context/IPC — no image bytes. */
export interface VisualOCRSummary {
  id: string;
  sourceFrameId: string;
  text: string;
  confidence: number;
  language: string | null;
  status: string;
  createdAt: number;
  processingTimeMs: number;
}

/** Safe vision summary for context/IPC — no image bytes. */
export interface VisualVisionSummary {
  id: string;
  sourceFrameId: string;
  description: string;
  contentType: string;
  confidence: number;
  relevantText: string;
  technicalElements: Array<{ kind: string; value: string; confidence: number }>;
  detectedEntities: string[];
  warnings: string[];
  status: string;
  createdAt: number;
  processingTimeMs: number;
}

export interface VisualContextSnapshot {
  frames: VisualFrameReference[];
  latestFrame: VisualFrameReference | null;
  capturedAt: number | null;
  source: VisualSourceKind;
  ocrResults: VisualOCRSummary[];
  visionAnalyses: VisualVisionSummary[];
  metadata: VisualContextMetadata;
}

export interface VisualContextStatus {
  state: VisualRuntimeState;
  enabled: boolean;
  source: VisualSourceKind;
  selectedSourceId: string | null;
  frameCount: number;
  latestCaptureAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  permissionGranted: boolean | null;
  capabilities: VisualCaptureCapabilities;
}

export type VisualEventType =
  | 'visual.status.changed'
  | 'visual.frame.captured'
  | 'visual.frame.rejected'
  | 'visual.context.changed'
  | 'visual.capability.changed';

export interface VisualEvent {
  type: VisualEventType;
  timestamp: number;
  frameId?: string;
  source?: VisualSourceKind;
  state?: VisualRuntimeState;
  code?: string;
  message?: string;
  width?: number;
  height?: number;
  byteSize?: number;
}
