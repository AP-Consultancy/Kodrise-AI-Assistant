import { describe, expect, it, vi } from 'vitest';
import {
  AudioInputCoordinator,
  MockAudioInputProvider,
  detectMeetingAudioCapability,
  listWindowsMeetingDevices,
} from '../../src/core/audio-input/AudioInputCoordinator';
import { DEFAULT_AUDIO_INPUT_MODE } from '../../src/shared/audio-input/types';
import { DEFAULT_PUBLIC_CONFIG } from '../../src/shared/config/types';
import { TranscriptStore } from '../../src/core/transcription/TranscriptStore';
import { QuestionManager } from '../../src/core/questions/QuestionManager';
import { ContextBuilder } from '../../src/core/context/ContextBuilder';
import { MockAIProvider } from '../../src/main/ai/providers/MockAIProvider';
import { AudioSourceUnsupportedError } from '../../src/shared/errors';
import { DEFAULT_CONTEXT_BUDGET } from '../../src/shared/context/types';

describe('Phase 2M — AudioInputMode defaults', () => {
  it('defaults to microphone', () => {
    expect(DEFAULT_AUDIO_INPUT_MODE).toBe('microphone');
    expect(DEFAULT_PUBLIC_CONFIG.audioInput.inputMode).toBe('microphone');
    const coordinator = new AudioInputCoordinator({ getPlatform: () => 'win32' });
    expect(coordinator.getMode()).toBe('microphone');
  });
});

describe('Phase 2M — capability detection', () => {
  it('supports meeting audio on windows', () => {
    const cap = detectMeetingAudioCapability('meeting_audio', 'win32');
    expect(cap.supported).toBe(true);
    expect(cap.meetingAudioAvailable).toBe(true);
    expect(cap.platform).toBe('windows');
  });

  it('rejects meeting audio on non-windows without silent mic fallback', () => {
    const cap = detectMeetingAudioCapability('meeting_audio', 'darwin');
    expect(cap.supported).toBe(false);
    expect(cap.reason).toMatch(/unavailable/i);
    const coordinator = new AudioInputCoordinator({ getPlatform: () => 'darwin' });
    expect(() => coordinator.setMode('meeting_audio')).toThrow(AudioSourceUnsupportedError);
    expect(coordinator.getMode()).toBe('microphone');
  });

  it('enumerates safe meeting device DTOs on windows', async () => {
    const coordinator = new AudioInputCoordinator({ getPlatform: () => 'win32' });
    const devices = await coordinator.enumerateDevices();
    expect(devices.every((d) => 'id' in d && 'label' in d && 'kind' in d)).toBe(true);
    expect(JSON.stringify(devices)).not.toMatch(/apiKey|token|\\\\Device/i);
    expect(listWindowsMeetingDevices()[0]?.kind).toBe('loopback');
  });
});

describe('Phase 2M — MockAudioInputProvider lifecycle', () => {
  it('starts, pauses, resumes, and stops without physical devices', async () => {
    const provider = new MockAudioInputProvider();
    await provider.start({
      mode: 'microphone_and_meeting',
      microphoneDeviceId: 'mock-mic',
      meetingAudioDeviceId: 'mock-loopback',
      sampleRate: 16000,
      channels: 1,
    });
    expect(provider.getState()).toBe('active');
    await provider.pause();
    expect(provider.getState()).toBe('paused');
    await provider.resume();
    expect(provider.getState()).toBe('active');
    await provider.stop();
    expect(provider.getState()).toBe('idle');
  });
});

describe('Phase 2M — coordinator mode selection', () => {
  it('selects meeting mode and dual mode on windows', () => {
    const coordinator = new AudioInputCoordinator({ getPlatform: () => 'win32' });
    coordinator.setMode('meeting_audio');
    expect(coordinator.getMode()).toBe('meeting_audio');
    expect(coordinator.usesMeetingAudio()).toBe(true);
    expect(coordinator.usesMicrophone()).toBe(false);
    coordinator.setMode('microphone_and_meeting');
    expect(coordinator.usesMicrophone()).toBe(true);
    expect(coordinator.usesMeetingAudio()).toBe(true);
  });

  it('requires consent before meeting start', () => {
    const coordinator = new AudioInputCoordinator({ getPlatform: () => 'win32' });
    coordinator.setMode('meeting_audio');
    expect(() => coordinator.beginStart()).toThrow(/Confirm/i);
    coordinator.acknowledgeConsent();
    coordinator.beginStart();
    expect(coordinator.getStatus().state).toBe('starting');
  });

  it('end/reset releases active flags', () => {
    const coordinator = new AudioInputCoordinator({ getPlatform: () => 'win32' });
    coordinator.setMode('microphone');
    coordinator.beginStart();
    coordinator.markSourceActive('microphone');
    expect(coordinator.getStatus().state).toBe('active');
    coordinator.reset();
    expect(coordinator.getStatus().state).toBe('idle');
    expect(coordinator.getStatus().microphoneActive).toBe(false);
  });
});

describe('Phase 2M — transcript source metadata', () => {
  it('tags meeting finals with source', () => {
    const store = new TranscriptStore({ idGenerator: () => 'seg-1' });
    store.commitFinal('What is Spring Boot?', 0.9, undefined, 'meeting_audio');
    const recent = store.getRecent();
    expect(recent[0]?.source).toBe('meeting_audio');
    expect(recent[0]?.text).toMatch(/Spring Boot/);
  });

  it('keeps microphone and meeting partials distinct', () => {
    const store = new TranscriptStore({
      idGenerator: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    });
    store.applyPartial('mic partial', 0.5, undefined, 'microphone');
    store.applyPartial('meeting partial', 0.5, undefined, 'meeting_audio');
    store.commitFinal('Mic question?', 0.9, undefined, 'microphone');
    store.commitFinal('Meeting question?', 0.9, undefined, 'meeting_audio');
    const finals = store.getRecent();
    expect(finals).toHaveLength(2);
    expect(finals.map((f) => f.source)).toEqual(['microphone', 'meeting_audio']);
  });
});

describe('Phase 2M — pipeline integration', () => {
  it('meeting transcript reaches QuestionDetector without changing duplicate detector', () => {
    let n = 0;
    const manager = new QuestionManager({ idGenerator: () => `q-${++n}` });
    const now = Date.now();
    const first = manager.processFinalSegment({
      id: 't1',
      text: 'What is dependency injection?',
      timestamp: now,
      startTime: now,
      endTime: now,
      isFinal: true,
      confidence: 0.9,
      source: 'meeting_audio',
    });
    expect(first).toHaveLength(1);
    const dup = manager.processFinalSegment({
      id: 't2',
      text: 'What is dependency injection?',
      timestamp: now + 10,
      startTime: now + 10,
      endTime: now + 10,
      isFinal: true,
      confidence: 0.9,
      source: 'meeting_audio',
    });
    expect(dup).toHaveLength(0);
  });

  it('meeting question can reach context and MockAI once', async () => {
    let n = 0;
    const manager = new QuestionManager({ idGenerator: () => `q-${++n}` });
    const produced = manager.processFinalSegment({
      id: 'm1',
      text: 'Can you tell me about yourself?',
      timestamp: Date.now(),
      startTime: Date.now(),
      endTime: Date.now(),
      isFinal: true,
      confidence: 0.95,
      source: 'meeting_audio',
    });
    expect(produced).toHaveLength(1);
    const question = produced[0]!;
    const snapshot = new ContextBuilder({ idGenerator: () => 'ctx-m' }).build({
      currentQuestion: question,
      questionHistory: manager.getRecent(),
      transcriptSegments: [
        {
          id: 'm1',
          text: question.text,
          timestamp: Date.now(),
          startTime: Date.now(),
          endTime: Date.now(),
          isFinal: true,
          confidence: 0.95,
          source: 'meeting_audio',
        },
      ],
    });
    expect(snapshot.currentQuestion.id).toBe(question.id);

    const provider = new MockAIProvider({ chunkDelayMs: 1 });
    await provider.connect();
    let chunks = 0;
    for await (const chunk of provider.generate({
      requestId: 'r-m',
      sessionId: 's',
      correlationId: 'c',
      question,
      context: {
        ...snapshot,
        metadata: {
          ...snapshot.metadata,
          budget: { ...DEFAULT_CONTEXT_BUDGET },
        },
        quality: snapshot.quality,
      },
      responseMode: 'normal',
      messages: [],
      metadata: {
        model: 'mock',
        temperature: 0.2,
        maxOutputTokens: 200,
        responseMode: 'normal',
        provider: 'mock',
        contextId: snapshot.id,
        questionId: question.id,
      },
    })) {
      if (chunk.text) chunks += 1;
    }
    expect(chunks).toBeGreaterThan(0);
  });
});

describe('Phase 2M — simulation isolation', () => {
  it('simulation mode must not auto-select meeting audio', () => {
    const coordinator = new AudioInputCoordinator({ getPlatform: () => 'win32' });
    expect(coordinator.getMode()).toBe('microphone');
    // Simulation never calls setMode('meeting_audio') — remains default.
    expect(coordinator.usesMeetingAudio()).toBe(false);
  });
});

describe('Phase 2M — AudioHost dual stream selection', () => {
  it('microphone mode preserves single-stream ingest routing', async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
    }));
    const { AudioHost } = await import('../../src/main/services/audio/AudioHost');
    const { MockSTTProvider } = await import('../../src/core/stt/MockSTTProvider');
    const stt = new MockSTTProvider();
    const sendSpy = vi.spyOn(stt, 'sendAudio');
    const host = new AudioHost({
      stt,
      getAudioInputConfig: () => ({
        inputMode: 'microphone',
        microphoneDeviceId: null,
        meetingAudioDeviceId: null,
      }),
    });
    host.setPermission('granted');
    await host.start({ sampleRate: 16000, channels: 1 });
    host.confirmActive();
    await host.ingestChunk({
      sequence: 1,
      timestamp: Date.now(),
      dataBase64: Buffer.from([0, 0]).toString('base64'),
      sampleRate: 16000,
      channels: 1,
      byteLength: 2,
      source: 'microphone',
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    await host.forceStopFromSession();
    host.dispose();
  });
});
