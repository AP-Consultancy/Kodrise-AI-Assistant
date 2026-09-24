import { describe, expect, it } from 'vitest';
import { redactMeta, REDACTED } from '../../src/main/services/logging/redact';

describe('audio / transcript logging safety', () => {
  it('does not leave raw audio or transcript payloads unredacted', () => {
    const redacted = redactMeta({
      event: 'audio.chunk',
      dataBase64: 'AAAAVERYLONGAUDIOBASE64====',
      audioData: new Array(32).fill(1).join(''),
      pcm: 'raw-bytes',
      transcriptText: 'secret spoken words',
      fullTranscript: 'should not appear in logs',
      sampleRate: 16000,
      sequence: 12,
    });

    expect(redacted).toEqual({
      event: 'audio.chunk',
      dataBase64: REDACTED,
      audioData: REDACTED,
      pcm: REDACTED,
      transcriptText: REDACTED,
      fullTranscript: REDACTED,
      sampleRate: 16000,
      sequence: 12,
    });
  });
});
