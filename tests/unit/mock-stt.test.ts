import { describe, expect, it } from 'vitest';
import { MockSTTProvider } from '../../src/core/stt/MockSTTProvider';

function pcmChunk(sequence: number) {
  return {
    sequence,
    timestamp: Date.now(),
    data: new ArrayBuffer(4),
    sampleRate: 16000,
    channels: 1,
  };
}

describe('MockSTTProvider lifecycle', () => {
  it('transitions disconnected → connecting → connected → disconnected', async () => {
    const stt = new MockSTTProvider();
    expect(stt.getStatus().status).toBe('disconnected');

    const statuses: string[] = [];
    stt.onStatus((status) => statuses.push(status.status));

    await stt.connect();
    expect(stt.getStatus().status).toBe('connected');
    expect(statuses).toContain('connecting');
    expect(statuses).toContain('connected');

    await stt.disconnect();
    expect(stt.getStatus().status).toBe('disconnected');
  });

  it('emits partial and final mock transcripts from chunk activity', async () => {
    const stt = new MockSTTProvider();
    await stt.connect();

    const partials: string[] = [];
    const finals: string[] = [];
    stt.onPartialTranscript((event) => {
      if (event.segment) {
        partials.push(event.segment.text);
      }
    });
    stt.onFinalTranscript((event) => {
      if (event.segment) {
        finals.push(event.segment.text);
      }
    });

    for (let sequence = 1; sequence <= 25; sequence += 1) {
      await stt.sendAudio(pcmChunk(sequence));
    }

    expect(stt.getStatus().status).toBe('streaming');
    expect(partials.length).toBeGreaterThan(0);
    expect(finals).toHaveLength(1);
    expect(finals[0]).toContain('Mock final transcript');
  });

  it('ignores audio while disconnected', async () => {
    const stt = new MockSTTProvider();
    let partialCount = 0;
    stt.onPartialTranscript(() => {
      partialCount += 1;
    });
    await stt.sendAudio(pcmChunk(5));
    expect(partialCount).toBe(0);
  });
});
