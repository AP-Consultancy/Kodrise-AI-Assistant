import type { AudioChunk } from '../../shared/audio/types';
import { STTAudioFormatError } from '../../shared/errors';

/** Capture-side PCM format produced by Phase 2A renderer encoding. */
export interface AudioCaptureFormat {
  encoding: 'pcm_s16le';
  sampleRate: number;
  channels: number;
}

/** Format expected by the active STT provider transport. */
export interface STTInputFormat {
  encoding: 'linear16';
  sampleRate: number;
  channels: number;
}

export const CAPTURE_PCM_FORMAT: AudioCaptureFormat = {
  encoding: 'pcm_s16le',
  sampleRate: 16000,
  channels: 1,
};

export const DEEPGRAM_LINEAR16_FORMAT: STTInputFormat = {
  encoding: 'linear16',
  sampleRate: 16000,
  channels: 1,
};

/**
 * Converts capture PCM into STT input bytes.
 * Phase 2B: Int16 LE mono 16 kHz maps 1:1 to Deepgram linear16 — no resampling.
 */
export function adaptCaptureChunkToSttInput(
  chunk: AudioChunk,
  target: STTInputFormat = DEEPGRAM_LINEAR16_FORMAT,
): ArrayBuffer {
  if (chunk.sampleRate !== target.sampleRate || chunk.channels !== target.channels) {
    throw new STTAudioFormatError('Audio chunk format does not match STT input requirements', {
      chunkSampleRate: chunk.sampleRate,
      chunkChannels: chunk.channels,
      targetSampleRate: target.sampleRate,
      targetChannels: target.channels,
      targetEncoding: target.encoding,
    });
  }

  if (chunk.data.byteLength === 0) {
    throw new STTAudioFormatError('Audio chunk is empty');
  }

  if (chunk.data.byteLength % 2 !== 0) {
    throw new STTAudioFormatError('PCM Int16 chunk byte length must be even', {
      byteLength: chunk.data.byteLength,
    });
  }

  // pcm_s16le === linear16 when sample rate/channels match — passthrough.
  return chunk.data;
}
