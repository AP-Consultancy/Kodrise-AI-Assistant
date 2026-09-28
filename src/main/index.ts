import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { ConfigurationService } from '../core/configuration/ConfigurationService';
import { registerAllIpcHandlers } from './ipc';
import { registerInterviewIpcHandlers } from './ipc/interviewHandlers';
import { createMainWindow } from './windows/createMainWindow';
import { initializeFileLogging, logger } from './services/logging';
import { SafeStorageCredentialVault } from './services/credentials/SafeStorageCredentialVault';
import { SessionHost } from './services/session/SessionHost';
import { AudioHost } from './services/audio/AudioHost';
import { setAppServices, getAppServices } from './services/appContext';
import { FilePublicConfigStore } from './services/config/FilePublicConfigStore';
import { createDefaultIdGenerator } from '../shared/session/types';
import { applyContentSecurityPolicy } from './security/csp';
import { STT_DEEPGRAM_CREDENTIAL_KEY, AI_OPENAI_CREDENTIAL_KEY, AI_GEMINI_CREDENTIAL_KEY } from '../shared/config/types';
import { createSttProvider } from './transcription/provider/createSttProvider';
import { createAiProvider } from './ai/createAiProvider';
import { getAiCredentialKey } from '../shared/ai/types';
import { CapturePolicyHost } from './capture/CapturePolicyHost';
import { VisualContextHost } from './visual/VisualContextHost';
import { InterviewHost } from './interview/InterviewHost';
import { SimulationHost } from './simulation/SimulationHost';
import { ProblemIntelligenceHost } from './problem-intelligence/ProblemIntelligenceHost';
import { QuestionCaptureHost } from './question-capture/QuestionCaptureHost';
import type { CapturePolicyId } from '../shared/capture-policy/types';
import { DEFAULT_QUESTION_CAPTURE_CONFIG } from '../shared/question-capture/types';

if (started) {
  app.quit();
} else {
  const gotLock = app.requestSingleInstanceLock();

  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      const [existing] = BrowserWindow.getAllWindows();
      if (existing) {
        if (existing.isMinimized()) {
          existing.restore();
        }
        existing.focus();
      }
    });

    app.whenReady().then(() => {
      initializeFileLogging();
      applyContentSecurityPolicy(app.isPackaged);

      const configStore = new FilePublicConfigStore();
      const config = new ConfigurationService({ store: configStore });
      const credentials = new SafeStorageCredentialVault();
      const sessionHost = new SessionHost(createDefaultIdGenerator());
      const audioHost = new AudioHost({
        getSttConfig: () => config.getPublic().stt,
        getAudioInputConfig: () =>
          config.getPublic().audioInput ?? {
            inputMode: 'microphone' as const,
            microphoneDeviceId: null,
            meetingAudioDeviceId: null,
          },
        persistAudioInputConfig: (patch) => {
          config.update({ audioInput: patch });
        },
        getContextConfig: () => config.getPublic().context,
        getAiConfig: () => config.getPublic().ai,
        getVisualContextSnapshot: () => {
          try {
            return getAppServices().visual.getSnapshot();
          } catch {
            return null;
          }
        },
        getInterviewDocuments: () => {
          try {
            return getAppServices().interview.getDocumentContext();
          } catch {
            return null;
          }
        },
        hasSttCredential: () => credentials.hasCredential(STT_DEEPGRAM_CREDENTIAL_KEY),
        hasAiCredential: async () => {
          const provider = config.getPublic().ai.provider;
          const key = getAiCredentialKey(provider);
          if (!key) return true;
          return credentials.hasCredential(key);
        },
        createSttProvider: (sttConfig) =>
          createSttProvider({
            config: sttConfig,
            getApiKey: () => credentials.getCredential(STT_DEEPGRAM_CREDENTIAL_KEY),
          }),
        createAiProvider: (aiConfig) =>
          createAiProvider({
            config: aiConfig,
            getApiKey: async () => {
              const key = getAiCredentialKey(aiConfig.provider);
              if (!key) return null;
              if (key === AI_GEMINI_CREDENTIAL_KEY) {
                return credentials.getCredential(AI_GEMINI_CREDENTIAL_KEY);
              }
              return credentials.getCredential(AI_OPENAI_CREDENTIAL_KEY);
            },
          }),
        sessionId: () => sessionHost.getManager().getStatus().sessionId,
        correlationId: () => sessionHost.getManager().getStatus().correlationId,
      });
      const capturePolicy = new CapturePolicyHost({
        getInitialPolicy: () => config.getPublic().capture.windowPrivacyPolicy,
        persistPolicy: (policy: CapturePolicyId) => {
          config.update({ capture: { windowPrivacyPolicy: policy } });
        },
      });
      const visual = new VisualContextHost({
        getConfig: () => config.getPublic().visualContext,
        getIntelligenceConfig: () => config.getPublic().visualIntelligence,
        getOpenAiApiKey: () => credentials.getCredential(AI_OPENAI_CREDENTIAL_KEY),
        getCurrentQuestion: () => {
          try {
            return audioHost.getCurrentQuestion();
          } catch {
            return null;
          }
        },
        getRelevantTranscript: () => {
          try {
            return audioHost
              .getTranscriptRecent(8)
              .map((segment) => segment.text)
              .join('\n');
          } catch {
            return null;
          }
        },
      });
      const interview = new InterviewHost({
        config,
        session: sessionHost,
        audio: audioHost,
        visual,
      });
      const simulation = new SimulationHost({
        interview,
        audio: audioHost,
        config,
      });
      const problemIntelligence = new ProblemIntelligenceHost({
        getAIProvider: async () => audioHost.ensureAiProvider(),
        sessionId: () => sessionHost.getManager().getStatus().sessionId,
        correlationId: () => sessionHost.getManager().getStatus().correlationId,
      });
      const questionCapture = new QuestionCaptureHost({
        getConfig: () =>
          config.getPublic().questionCapture ?? { ...DEFAULT_QUESTION_CAPTURE_CONFIG },
        persistConfig: (patch) => {
          config.update({ questionCapture: patch });
        },
        visual: () => getAppServices().visual,
        interview: () => getAppServices().interview,
        problemIntelligence: () => getAppServices().problemIntelligence,
        audio: () => getAppServices().audio,
        isInterviewLive: () => getAppServices().interview.getStatus().phase === 'live',
        isInterviewPaused: () => Boolean(getAppServices().interview.getStatus().paused),
      });
      setAppServices({
        config,
        credentials,
        session: sessionHost,
        audio: audioHost,
        capturePolicy,
        visual,
        interview,
        simulation,
        problemIntelligence,
        questionCapture,
        logger,
      });

      // Wire question → visual analysis after services are registered.
      audioHost.setOnQuestionClassified(async (question) => {
        await visual.analyzeForQuestion(question);
      });

      // Clear problem / capture sessions when the foundation session stops.
      sessionHost.getManager().subscribe((event) => {
        if (event.type !== 'status-changed') return;
        const state = sessionHost.getManager().getStatus().state;
        if (state === 'idle' || state === 'stopping') {
          problemIntelligence.resetForSessionStop();
          questionCapture.resetForSessionStop();
        }
      });

      questionCapture.registerHotkey();

      registerAllIpcHandlers();
      // Explicit second bind — document picker must remain registered.
      registerInterviewIpcHandlers();
      createMainWindow();
      logger.info('application.ready', {
        version: app.getVersion(),
        platform: process.platform,
        configPath: configStore.getFilePath(),
      });

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow();
        }
      });

      app.on('before-quit', () => {
        void audioHost.cancelAi();
        void audioHost.forceStopFromSession();
        void visual.onSessionStop();
        interview.dispose();
        simulation.dispose();
        problemIntelligence.dispose();
        questionCapture.dispose();
        audioHost.dispose();
        sessionHost.dispose();
        capturePolicy.dispose();
        visual.dispose();
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
  }
}
