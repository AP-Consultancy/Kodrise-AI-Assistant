import { describe, expect, it } from 'vitest';
import { VisualContextManager } from '../../src/core/visual-context/VisualContextManager';
import { MockVisualCaptureProvider } from '../../src/core/visual-context/MockVisualCaptureProvider';
import { VisualFrameValidator, hashVisualBytes } from '../../src/core/visual-context/VisualFrameValidator';
import { VisualFrameDeduplicator } from '../../src/core/visual-context/VisualFrameDeduplicator';
import { ContextBuilder } from '../../src/core/context/ContextBuilder';
import { DEFAULT_VISUAL_PUBLIC_CONFIG } from '../../src/shared/visual-context/types';
import { VisualCaptureNowSchema, VisualSetSourceSchema } from '../../src/shared/ipc/schemas';
import { AppError, toSafeErrorPayload, ValidationError } from '../../src/shared/errors';
import type { DetectedQuestion } from '../../src/shared/questions/types';

function question(id: string, text: string): DetectedQuestion {
  return {
    id,
    text,
    originalText: text,
    normalizedText: text,
    type: 'technical',
    status: 'classified',
    timestamp: Date.now(),
    sourceSegmentIds: ['s1'],
    detectionConfidence: 0.9,
    classificationConfidence: 0.8,
    isMultiPart: false,
    parts: [],
    parentQuestionId: null,
    relatedQuestionId: null,
  };
}

describe('Visual frame validation', () => {
  const validator = new VisualFrameValidator();

  it('rejects oversized images and NONE source', () => {
    expect(() =>
      validator.validate({
        bytes: new Uint8Array(64),
        width: 100,
        height: 100,
        mimeType: 'image/png',
        source: 'NONE',
        config: DEFAULT_VISUAL_PUBLIC_CONFIG,
      }),
    ).toThrow(AppError);

    expect(() =>
      validator.validate({
        bytes: new Uint8Array(DEFAULT_VISUAL_PUBLIC_CONFIG.maxImageBytes + 1),
        width: 100,
        height: 100,
        mimeType: 'image/png',
        source: 'DISPLAY',
        config: DEFAULT_VISUAL_PUBLIC_CONFIG,
      }),
    ).toThrow(/maximum byte size/i);
  });

  it('accepts valid frames', () => {
    expect(() =>
      validator.validate({
        bytes: new Uint8Array(128),
        width: 640,
        height: 360,
        mimeType: 'image/png',
        source: 'DISPLAY',
        config: DEFAULT_VISUAL_PUBLIC_CONFIG,
      }),
    ).not.toThrow();
  });
});

describe('Visual deduplication and manager lifecycle', () => {
  it('deduplicates by content hash', () => {
    const dedupe = new VisualFrameDeduplicator();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const hash = hashVisualBytes(bytes);
    const frame = {
      id: '1',
      timestamp: 1,
      width: 10,
      height: 10,
      mimeType: 'image/png' as const,
      byteSize: 4,
      source: 'DISPLAY' as const,
      sourceId: 'd1',
      contentHash: hash,
      captureDurationMs: 1,
      status: 'accepted' as const,
      bytes,
    };
    expect(dedupe.isDuplicate(frame, [frame])).toBe(true);
  });

  it('captures, bounds history, clears, and integrates with context snapshot', async () => {
    const provider = new MockVisualCaptureProvider();
    const manager = new VisualContextManager({
      provider,
      getConfig: () => ({ ...DEFAULT_VISUAL_PUBLIC_CONFIG, enabled: true, maxFrames: 2 }),
    });
    await manager.initializeForSession();
    manager.enable();
    manager.setSource('DISPLAY', 'mock-display-1');
    manager.start();

    const first = await manager.captureNow({
      sourceKind: 'DISPLAY',
      sourceId: 'a',
      manual: {
        mimeType: 'image/png',
        bytesBase64: Buffer.from('unique-frame-aaaaaaaaaaaaaaaaaaaaaaaa').toString('base64'),
      },
    });
    expect(first.width).toBeGreaterThan(0);

    await manager.captureNow({
      sourceKind: 'DISPLAY',
      sourceId: 'b',
      manual: {
        mimeType: 'image/png',
        bytesBase64: Buffer.from('unique-frame-bbbbbbbbbbbbbbbbbbbbbbbb').toString('base64'),
      },
    });
    await manager.captureNow({
      sourceKind: 'DISPLAY',
      sourceId: 'c',
      manual: {
        mimeType: 'image/png',
        bytesBase64: Buffer.from('unique-frame-cccccccccccccccccccccccc').toString('base64'),
      },
    });
    expect(manager.getStatus().frameCount).toBe(2);

    const visual = manager.getSnapshot();
    expect(visual.frames.length).toBe(2);
    expect(visual.metadata.truncated).toBe(true);

    const builder = new ContextBuilder({ idGenerator: () => 'ctx' });
    const snapshot = builder.build({
      currentQuestion: question('q1', 'What is on screen?'),
      questionHistory: [],
      transcriptSegments: [],
      visualContext: visual,
    });
    expect(snapshot.visualContext?.frames.length).toBe(2);
    expect(snapshot.metadata.sources).toContain('visual_context');
    expect(snapshot.metadata.visualFrameCount).toBe(2);

    manager.clear();
    expect(manager.getStatus().frameCount).toBe(0);

    manager.pause();
    expect(manager.getStatus().state).toBe('paused');
    manager.resume();
    expect(manager.getStatus().state).toBe('capturing');
    manager.stop();
    await manager.shutdownForSession();
    expect(manager.getStatus().state).toBe('disabled');
  });

  it('handles permission denial and capture failure', async () => {
    const provider = new MockVisualCaptureProvider();
    provider.setPermission(false);
    const manager = new VisualContextManager({ provider });
    manager.enable();
    manager.setSource('DISPLAY', 'mock-display-1');
    await expect(manager.captureNow({ sourceKind: 'DISPLAY' })).rejects.toThrow(/permission/i);

    provider.setPermission(true);
    provider.setFailNext(true);
    manager.enable();
    await expect(manager.captureNow({ sourceKind: 'DISPLAY' })).rejects.toThrow(/failed/i);
  });

  it('lists mock sources and capabilities', async () => {
    const provider = new MockVisualCaptureProvider();
    const caps = await provider.getCapabilities();
    expect(caps.displayCapture).toBe('SUPPORTED');
    const sources = await provider.listSources();
    expect(sources.length).toBeGreaterThan(0);
  });
});

describe('Visual IPC contracts', () => {
  it('validates set-source and capture-now payloads', () => {
    expect(VisualSetSourceSchema.safeParse({ source: 'DISPLAY' }).success).toBe(true);
    expect(VisualSetSourceSchema.safeParse({ source: 'CAMERA' }).success).toBe(false);
    expect(VisualCaptureNowSchema.safeParse({ sourceKind: 'WINDOW' }).success).toBe(true);
    expect(VisualCaptureNowSchema.safeParse({}).success).toBe(true);
  });

  it('maps validation errors safely', () => {
    const payload = toSafeErrorPayload(new ValidationError('Invalid visual source payload'));
    expect(payload.code).toBe('VALIDATION');
    expect(JSON.stringify(payload)).not.toMatch(/base64|image\//i);
  });
});
