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
import { STT_DEEPGRAM_CREDENTIAL_KEY, AI_OPENAI_CREDENTIAL_KEY } from '../shared/config/types';
import { createSttProvider } from './transcription/provider/createSttProvider';
import { createAiProvider } from './ai/createAiProvider';
import { CapturePolicyHost } from './capture/CapturePolicyHost';
import { VisualContextHost } from './visual/VisualContextHost';
import { InterviewHost } from './interview/InterviewHost';
import { SimulationHost } from './simulation/SimulationHost';
import type { CapturePolicyId } from '../shared/capture-policy/types';

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
        hasAiCredential: () => credentials.hasCredential(AI_OPENAI_CREDENTIAL_KEY),
        createSttProvider: (sttConfig) =>
          createSttProvider({
            config: sttConfig,
            getApiKey: () => credentials.getCredential(STT_DEEPGRAM_CREDENTIAL_KEY),
          }),
        createAiProvider: (aiConfig) =>
          createAiProvider({
            config: aiConfig,
            getApiKey: () => credentials.getCredential(AI_OPENAI_CREDENTIAL_KEY),
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
      setAppServices({
        config,
        credentials,
        session: sessionHost,
        audio: audioHost,
        capturePolicy,
        visual,
        interview,
        simulation,
        logger,
      });

      // Wire question → visual analysis after services are registered.
      audioHost.setOnQuestionClassified(async (question) => {
        await visual.analyzeForQuestion(question);
      });

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
