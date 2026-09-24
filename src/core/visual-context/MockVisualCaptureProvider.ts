import type {
  VisualCaptureCapabilities,
  VisualCaptureRequest,
  VisualCaptureSource,
  VisualFrame,
} from '../../shared/visual-context/types';
import { AppError } from '../../shared/errors';
import { createDefaultIdGenerator } from '../../shared/session/types';
import type { VisualCaptureProvider } from './VisualCaptureProvider';
import { hashVisualBytes } from './VisualFrameValidator';

/** Deterministic provider for unit tests — no Electron. */
export class MockVisualCaptureProvider implements VisualCaptureProvider {
  private readonly createId = createDefaultIdGenerator();
  private disposed = false;
  private permissionGranted = true;
  private failNext = false;

  setPermission(granted: boolean): void {
    this.permissionGranted = granted;
  }

  setFailNext(value: boolean): void {
    this.failNext = value;
  }

  async getCapabilities(): Promise<VisualCaptureCapabilities> {
    return {
      platform: 'windows',
      displayCapture: 'SUPPORTED',
      windowCapture: 'SUPPORTED',
      regionCapture: 'PARTIAL',
      manualImage: 'SUPPORTED',
      permissionRequired: false,
      permissionGranted: this.permissionGranted,
      maxRecommendedWidth: 1280,
      maxRecommendedHeight: 720,
      maxFrameBytes: 1_500_000,
      notes: ['Mock visual capture provider'],
    };
  }

  async listSources(): Promise<VisualCaptureSource[]> {
    return [
      { id: 'mock-display-1', name: 'Mock Display', kind: 'DISPLAY' },
      { id: 'mock-window-1', name: 'Mock Window', kind: 'WINDOW' },
    ];
  }

  async requestPermission(): Promise<boolean> {
    return this.permissionGranted;
  }

  async capture(request: VisualCaptureRequest): Promise<VisualFrame> {
    if (this.disposed) {
      throw new AppError('PROVIDER', 'Visual provider unavailable', {
        details: { code: 'provider_unavailable' },
      });
    }
    if (!this.permissionGranted) {
      throw new AppError('AUTHORIZATION', 'Visual capture permission denied', {
        details: { code: 'permission_denied' },
      });
    }
    if (this.failNext) {
      this.failNext = false;
      throw new AppError('PROVIDER', 'Mock capture failed', {
        details: { code: 'capture_failed' },
      });
    }
    if (request.sourceKind === 'NONE') {
      throw new AppError('VALIDATION', 'Invalid source', { details: { code: 'invalid_source' } });
    }

    let bytes: Uint8Array;
    if (request.manual?.bytesBase64) {
      bytes = Uint8Array.from(Buffer.from(request.manual.bytesBase64, 'base64'));
    } else {
      const payload = Buffer.from(
        `mock-frame:${request.sourceId ?? request.sourceKind}:${Date.now()}`.padEnd(48, '0'),
      );
      bytes = Uint8Array.from(payload);
    }

    const width = request.region?.width ?? 640;
    const height = request.region?.height ?? 360;
    return {
      id: this.createId(),
      timestamp: Date.now(),
      width,
      height,
      mimeType: request.manual?.mimeType ?? 'image/png',
      byteSize: bytes.byteLength,
      source: request.sourceKind,
      sourceId: request.sourceId ?? null,
      contentHash: hashVisualBytes(bytes),
      captureDurationMs: 1,
      status: 'accepted',
      bytes,
    };
  }

  async stop(): Promise<void> {
    return;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}
