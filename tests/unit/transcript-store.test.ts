import { describe, expect, it } from 'vitest';
import { TranscriptStore } from '../../src/core/transcription/TranscriptStore';

describe('TranscriptStore', () => {
  it('updates partial transcripts in place', () => {
    const store = new TranscriptStore({ maxFinals: 5, idGenerator: () => 'seg-1' });
    const first = store.applyPartial('Hel');
    const second = store.applyPartial('Hello');
    expect(first.id).toBe(second.id);
    expect(store.getSnapshot().partialText).toBe('Hello');
    expect(store.getStatus().hasPartial).toBe(true);
  });

  it('finalizes by replacing the active partial', () => {
    const store = new TranscriptStore({ maxFinals: 5, idGenerator: () => 'seg-1' });
    store.applyPartial('Hello wor');
    const final = store.commitFinal('Hello world', 0.9);
    expect(final).toMatchObject({
      id: 'seg-1',
      text: 'Hello world',
      isFinal: true,
      confidence: 0.9,
    });
    expect(store.getSnapshot().partialText).toBeNull();
    expect(store.getRecent()).toHaveLength(1);
  });

  it('keeps transcript history bounded', () => {
    const store = new TranscriptStore({
      maxFinals: 3,
      idGenerator: (() => {
        let index = 0;
        return () => `id-${(index += 1)}`;
      })(),
    });
    store.commitFinal('one');
    store.commitFinal('two');
    store.commitFinal('three');
    store.commitFinal('four');
    const recent = store.getRecent();
    expect(recent).toHaveLength(3);
    expect(recent.map((segment) => segment.text)).toEqual(['two', 'three', 'four']);
    expect(store.getStatus().segmentCount).toBe(3);
    expect(store.getStatus().maxFinals).toBe(3);
  });

  it('clears transcript state', () => {
    const store = new TranscriptStore();
    store.applyPartial('temp');
    store.commitFinal('done');
    store.clear();
    expect(store.getSnapshot()).toMatchObject({
      partialText: null,
      finals: [],
    });
  });
});
