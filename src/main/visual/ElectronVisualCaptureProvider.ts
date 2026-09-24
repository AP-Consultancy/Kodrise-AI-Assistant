import { desktopCapturer, dialog, nativeImage, systemPreferences } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  VisualCaptureCapabilities,
  VisualCaptureRequest,
  VisualCaptureSource,
  VisualFrame,
  VisualPublicConfig,
} from '../../shared/visual-context/types';
import { DEFAULT_VISUAL_PUBLIC_CONFIG } from '../../shared/visual-context/types';
import { AppError } from '../../shared/errors';
import { createDefaultIdGenerator } from '../../shared/session/types';
import type { VisualCaptureProvider } from '../../core/visual-context/VisualCaptureProvider';
import { hashVisualBytes } from '../../core/visual-context/VisualFrameValidator';

export interface ElectronVisualCaptureProviderOptions {
  getConfig?: () => VisualPublicConfig;
}

/**
 * Documented Electron desktopCapturer + nativeImage implementation.
 * Transient frames only — no permanent image persistence.
 */
export class ElectronVisualCaptureProvider implements VisualCaptureProvider {
  private readonly createId = createDefaultIdGenerator();
  private readonly getConfig: () => VisualPublicConfig;
  private disposed = false;

  constructor(options: ElectronVisualCaptureProviderOptions = {}) {
    this.getConfig = options.getConfig ?? (() => structuredClone(DEFAULT_VISUAL_PUBLIC_CONFIG));
  }

  async getCapabilities(): Promise<VisualCaptureCapabilities> {
    const config = this.getConfig();
    const platform = mapPlatform(process.platform);
    const apiAvailable = typeof desktopCapturer?.getSources === 'function';
    const permission = await this.readPermission();

    const notes: string[] = [];
    if (!apiAvailable) {
      notes.push('desktopCapturer.getSources is unavailable in this Electron build.');
    }

    let displayCapture: VisualCaptureCapabilities['displayCapture'] = 'UNSUPPORTED';
    let windowCapture: VisualCaptureCapabilities['windowCapture'] = 'UNSUPPORTED';
    let regionCapture: VisualCaptureCapabilities['regionCapture'] = 'UNSUPPORTED';

    if (apiAvailable) {
      if (platform === 'windows') {
        displayCapture = 'SUPPORTED';
        windowCapture = 'SUPPORTED';
        regionCapture = 'PARTIAL';
        notes.push('Windows: display/window capture via desktopCapturer; region via crop.');
      } else if (platform === 'macos') {
        displayCapture = permission === true ? 'SUPPORTED' : 'PARTIAL';
        windowCapture = permission === true ? 'SUPPORTED' : 'PARTIAL';
        regionCapture = 'PARTIAL';
        notes.push('macOS: Screen Recording permission may be required.');
      } else if (platform === 'linux') {
        displayCapture = 'PARTIAL';
        windowCapture = 'PARTIAL';
        regionCapture = 'PARTIAL';
        notes.push('Linux: availability depends on display server and compositor.');
      } else {
        displayCapture = 'UNKNOWN';
        windowCapture = 'UNKNOWN';
        regionCapture = 'UNKNOWN';
      }
    }

    return {
      platform,
      displayCapture,
      windowCapture,
      regionCapture,
      manualImage: 'SUPPORTED',
      permissionRequired: platform === 'macos',
      permissionGranted: permission,
      maxRecommendedWidth: config.maxWidth,
      maxRecommendedHeight: config.maxHeight,
      maxFrameBytes: config.maxImageBytes,
      notes,
    };
  }

  async listSources(): Promise<VisualCaptureSource[]> {
    this.assertAvailable();
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 160, height: 90 },
      fetchWindowIcons: false,
    });
    return sources.map((source) => {
      const kind = source.id.startsWith('screen:') ? ('DISPLAY' as const) : ('WINDOW' as const);
      return {
        id: source.id,
        name: source.name,
        kind,
        displayId: source.display_id || undefined,
        thumbnailDataUrl: source.thumbnail.isEmpty()
          ? undefined
          : source.thumbnail.resize({ width: 160, height: 90 }).toDataURL(),
      };
    });
  }

  async requestPermission(): Promise<boolean> {
    if (process.platform !== 'darwin') {
      return true;
    }
    const status = systemPreferences.getMediaAccessStatus('screen');
    return status === 'granted';
  }

  async capture(request: VisualCaptureRequest): Promise<VisualFrame> {
    this.assertAvailable();
    const started = Date.now();
    const config = this.getConfig();

    if (request.sourceKind === 'MANUAL_IMAGE') {
      return this.captureManual(request, started);
    }

    if (request.sourceKind === 'NONE') {
      throw new AppError('VALIDATION', 'Invalid visual source', { details: { code: 'invalid_source' } });
    }

    if (process.platform === 'darwin') {
      const permitted = await this.requestPermission();
      if (!permitted) {
        const status = systemPreferences.getMediaAccessStatus('screen');
        if (status === 'denied' || status === 'restricted') {
          throw new AppError('AUTHORIZATION', 'Screen recording permission denied', {
            details: { code: 'permission_denied' },
          });
        }
      }
    }

    const types =
      request.sourceKind === 'WINDOW'
        ? (['window'] as const)
        : request.sourceKind === 'DISPLAY' || request.sourceKind === 'REGION'
          ? (['screen'] as const)
          : (['screen', 'window'] as const);

    const sources = await desktopCapturer.getSources({
      types: [...types],
      thumbnailSize: {
        width: config.maxWidth,
        height: config.maxHeight,
      },
      fetchWindowIcons: false,
    });

    const source = request.sourceId
      ? sources.find((item) => item.id === request.sourceId)
      : sources[0];

    if (!source) {
      throw new AppError('VALIDATION', 'Visual capture source unavailable', {
        details: { code: 'source_unavailable' },
      });
    }

    if (source.thumbnail.isEmpty()) {
      throw new AppError('PROVIDER', 'Visual capture failed — empty thumbnail', {
        details: { code: 'capture_failed' },
      });
    }

    let image = source.thumbnail;
    if (request.sourceKind === 'REGION' && request.region) {
      const { x, y, width, height } = request.region;
      if (width < 1 || height < 1) {
        throw new AppError('VALIDATION', 'Invalid region dimensions', {
          details: { code: 'invalid_dimensions' },
        });
      }
      image = image.crop({ x, y, width, height });
    }

    const size = image.getSize();
    if (size.width > config.maxWidth || size.height > config.maxHeight) {
      image = image.resize({
        width: Math.min(size.width, config.maxWidth),
        height: Math.min(size.height, config.maxHeight),
        quality: 'better',
      });
    }

    const png = image.toPNG();
    if (png.byteLength > config.maxImageBytes) {
      const jpeg = image.toJPEG(80);
      if (jpeg.byteLength <= config.maxImageBytes) {
        const finalSize = image.getSize();
        const bytes = Uint8Array.from(jpeg);
        return this.toFrame({
          bytes,
          width: finalSize.width,
          height: finalSize.height,
          mimeType: 'image/jpeg',
          source: request.sourceKind,
          sourceId: source.id,
          started,
        });
      }
      throw new AppError('VALIDATION', 'Captured image exceeds maximum byte size', {
        details: { code: 'image_too_large', byteSize: png.byteLength },
      });
    }

    const finalSize = image.getSize();
    const bytes = Uint8Array.from(png);
    return this.toFrame({
      bytes,
      width: finalSize.width,
      height: finalSize.height,
      mimeType: 'image/png',
      source: request.sourceKind,
      sourceId: source.id,
      started,
    });
  }

  async stop(): Promise<void> {
    return;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  /** Opens a file dialog for explicit manual image selection. */
  async pickManualImage(): Promise<VisualCaptureRequest['manual']> {
    const result = await dialog.showOpenDialog({
      title: 'Select image for visual context',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) {
      throw new AppError('VALIDATION', 'Manual image selection cancelled', {
        details: { code: 'invalid_source' },
      });
    }
    const filePath = result.filePaths[0]!;
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/png';
    return {
      mimeType,
      bytesBase64: buffer.toString('base64'),
      fileName: path.basename(filePath),
    };
  }

  private async captureManual(
    request: VisualCaptureRequest,
    started: number,
  ): Promise<VisualFrame> {
    const manual = request.manual ?? (await this.pickManualImage());
    if (!manual) {
      throw new AppError('VALIDATION', 'Manual image required', {
        details: { code: 'invalid_source' },
      });
    }
    const config = this.getConfig();
    const buffer = Buffer.from(manual.bytesBase64, 'base64');
    if (buffer.byteLength > config.maxImageBytes) {
      throw new AppError('VALIDATION', 'Image exceeds maximum byte size', {
        details: { code: 'image_too_large' },
      });
    }
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) {
      throw new AppError('VALIDATION', 'Unsupported or invalid image format', {
        details: { code: 'unsupported_format' },
      });
    }
    let prepared = image;
    const size = prepared.getSize();
    if (size.width > config.maxWidth || size.height > config.maxHeight) {
      prepared = prepared.resize({
        width: Math.min(size.width, config.maxWidth),
        height: Math.min(size.height, config.maxHeight),
        quality: 'better',
      });
    }
    const out =
      manual.mimeType === 'image/jpeg' ? prepared.toJPEG(85) : prepared.toPNG();
    const finalSize = prepared.getSize();
    return this.toFrame({
      bytes: Uint8Array.from(out),
      width: finalSize.width,
      height: finalSize.height,
      mimeType: manual.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      source: 'MANUAL_IMAGE',
      sourceId: manual.fileName ?? null,
      started,
    });
  }

  private toFrame(input: {
    bytes: Uint8Array;
    width: number;
    height: number;
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    source: VisualFrame['source'];
    sourceId: string | null;
    started: number;
  }): VisualFrame {
    return {
      id: this.createId(),
      timestamp: Date.now(),
      width: input.width,
      height: input.height,
      mimeType: input.mimeType,
      byteSize: input.bytes.byteLength,
      source: input.source,
      sourceId: input.sourceId,
      contentHash: hashVisualBytes(input.bytes),
      captureDurationMs: Date.now() - input.started,
      status: 'accepted',
      bytes: input.bytes,
    };
  }

  private async readPermission(): Promise<boolean | null> {
    if (process.platform !== 'darwin') {
      return true;
    }
    const status = systemPreferences.getMediaAccessStatus('screen');
    if (status === 'granted') return true;
    if (status === 'denied' || status === 'restricted') return false;
    return null;
  }

  private assertAvailable(): void {
    if (this.disposed) {
      throw new AppError('PROVIDER', 'Visual provider unavailable', {
        details: { code: 'provider_unavailable' },
      });
    }
    if (typeof desktopCapturer?.getSources !== 'function') {
      throw new AppError('CONFIGURATION', 'Visual capture unsupported on this platform', {
        details: { code: 'unsupported_platform' },
      });
    }
  }
}

function mapPlatform(platform: NodeJS.Platform): VisualCaptureCapabilities['platform'] {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'unknown';
}
