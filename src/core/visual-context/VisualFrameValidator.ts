import { createHash } from 'node:crypto';
import type {
  VisualFrame,
  VisualMimeType,
  VisualPublicConfig,
  VisualSourceKind,
} from '../../shared/visual-context/types';
import { AppError } from '../../shared/errors';

export class VisualFrameValidator {
  validate(input: {
    bytes: Uint8Array;
    width: number;
    height: number;
    mimeType: VisualMimeType;
    source: VisualSourceKind;
    config: VisualPublicConfig;
  }): void {
    if (input.source === 'NONE') {
      throw new AppError('VALIDATION', 'Visual source is NONE', {
        details: { code: 'invalid_source' },
      });
    }
    if (!Number.isFinite(input.width) || !Number.isFinite(input.height)) {
      throw new AppError('VALIDATION', 'Invalid image dimensions', {
        details: { code: 'invalid_dimensions' },
      });
    }
    if (input.width < 1 || input.height < 1) {
      throw new AppError('VALIDATION', 'Image dimensions must be positive', {
        details: { code: 'invalid_dimensions' },
      });
    }
    if (input.width > input.config.maxWidth || input.height > input.config.maxHeight) {
      throw new AppError('VALIDATION', 'Image dimensions exceed configured limits', {
        details: {
          code: 'invalid_dimensions',
          width: input.width,
          height: input.height,
          maxWidth: input.config.maxWidth,
          maxHeight: input.config.maxHeight,
        },
      });
    }
    if (input.bytes.byteLength < 32) {
      throw new AppError('VALIDATION', 'Image payload too small', {
        details: { code: 'unsupported_format' },
      });
    }
    if (input.bytes.byteLength > input.config.maxImageBytes) {
      throw new AppError('VALIDATION', 'Image exceeds maximum byte size', {
        details: {
          code: 'image_too_large',
          byteSize: input.bytes.byteLength,
          max: input.config.maxImageBytes,
        },
      });
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(input.mimeType)) {
      throw new AppError('VALIDATION', 'Unsupported image format', {
        details: { code: 'unsupported_format', mimeType: input.mimeType },
      });
    }
  }
}

export function hashVisualBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function toFrameReference(frame: VisualFrame) {
  const { bytes: _bytes, ...reference } = frame;
  return reference;
}
