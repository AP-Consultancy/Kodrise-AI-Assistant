import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../src/shared/ipc/channels';
import { InterviewPickDocumentSchema } from '../../src/shared/ipc/schemas';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
      if (handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`);
      }
      handlers.set(channel, listener);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  app: {
    isPackaged: false,
    getVersion: () => '0.1.0',
    getPath: () => '/tmp',
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('../../src/main/services/appContext', () => ({
  getAppServices: () => ({
    interview: {
      getStatus: vi.fn(),
      getDocuments: vi.fn(),
      pickAndAddDocument: vi.fn(async () => ({
        id: 'doc-1',
        kind: 'resume',
        fileName: 'resume.pdf',
      })),
      removeDocument: vi.fn(),
      startInterview: vi.fn(),
      markListeningActive: vi.fn(),
      pauseInterview: vi.fn(),
      resumeInterview: vi.fn(),
      endInterview: vi.fn(),
      newInterview: vi.fn(),
      submitManualQuestion: vi.fn(),
      regenerate: vi.fn(),
    },
    config: { getPublic: () => ({}) },
    credentials: {
      hasCredential: () => false,
      setCredential: vi.fn(),
      deleteCredential: vi.fn(),
      getStorageStatus: () => 'available',
    },
    session: {
      getManager: () => ({
        getStatus: () => ({ state: 'idle', sessionId: null, correlationId: null }),
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      }),
    },
    audio: {},
    capturePolicy: {},
    visual: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }),
}));

vi.mock('../../src/main/services/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('Interview document picker IPC registration', () => {
  beforeEach(() => {
    handlers.clear();
    vi.resetModules();
  });

  it('registers interview:pick-document via registerInterviewIpcHandlers', async () => {
    const { registerInterviewIpcHandlers } = await import(
      '../../src/main/ipc/interviewHandlers'
    );
    registerInterviewIpcHandlers();

    expect(handlers.has(IpcChannels.INTERVIEW_PICK_DOCUMENT)).toBe(true);
    expect(IpcChannels.INTERVIEW_PICK_DOCUMENT).toBe('interview:pick-document');
  });

  it('keeps pick-document registered after a second full IPC bootstrap', async () => {
    const { registerAllIpcHandlers } = await import('../../src/main/ipc');

    expect(() => registerAllIpcHandlers()).not.toThrow();
    expect(handlers.has(IpcChannels.INTERVIEW_PICK_DOCUMENT)).toBe(true);

    // Simulates Vite main HMR / repeated whenReady bootstrap.
    expect(() => registerAllIpcHandlers()).not.toThrow();
    expect(handlers.has(IpcChannels.INTERVIEW_PICK_DOCUMENT)).toBe(true);
  });

  it('still registers pick-document when an earlier IPC group throws', async () => {
    const electron = await import('electron');
    const originalHandle = electron.ipcMain.handle.bind(electron.ipcMain);
    let appCalls = 0;
    vi.spyOn(electron.ipcMain, 'handle').mockImplementation((channel, listener) => {
      if (String(channel).startsWith('app:') && appCalls === 0) {
        appCalls += 1;
        throw new Error('simulated app handler failure');
      }
      return originalHandle(channel, listener);
    });

    const { registerAllIpcHandlers } = await import('../../src/main/ipc');
    expect(() => registerAllIpcHandlers()).not.toThrow();
    expect(handlers.has(IpcChannels.INTERVIEW_PICK_DOCUMENT)).toBe(true);
  });

  it('rejects invalid pick-document payloads via schema', () => {
    expect(InterviewPickDocumentSchema.safeParse({}).success).toBe(false);
    expect(InterviewPickDocumentSchema.safeParse({ kind: 'resume' }).success).toBe(true);
  });
});
