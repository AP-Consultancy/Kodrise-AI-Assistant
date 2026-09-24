import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import { logger } from '../services/logging';
import { registerAppIpcHandlers } from './appHandlers';
import { registerSystemIpcHandlers } from './systemHandlers';
import { registerSessionIpcHandlers } from './sessionHandlers';
import { registerConfigIpcHandlers } from './configHandlers';
import { registerCredentialsIpcHandlers } from './credentialsHandlers';
import { registerFoundationIpcHandlers } from './foundationHandlers';
import { registerAudioIpcHandlers } from './audioHandlers';
import { registerTranscriptIpcHandlers } from './transcriptHandlers';
import { registerQuestionIpcHandlers } from './questionHandlers';
import { registerContextIpcHandlers } from './contextHandlers';
import { registerAiIpcHandlers } from './aiHandlers';
import { registerCapturePolicyIpcHandlers } from './capturePolicyHandlers';
import { registerVisualIpcHandlers } from './visualHandlers';
import { registerInterviewIpcHandlers } from './interviewHandlers';
import { registerSimulationIpcHandlers } from './simulationHandlers';

const HANDLER_GROUPS: Array<{ name: string; register: () => void }> = [
  { name: 'app', register: registerAppIpcHandlers },
  { name: 'system', register: registerSystemIpcHandlers },
  { name: 'session', register: registerSessionIpcHandlers },
  { name: 'config', register: registerConfigIpcHandlers },
  { name: 'credentials', register: registerCredentialsIpcHandlers },
  { name: 'foundation', register: registerFoundationIpcHandlers },
  { name: 'audio', register: registerAudioIpcHandlers },
  { name: 'transcript', register: registerTranscriptIpcHandlers },
  { name: 'question', register: registerQuestionIpcHandlers },
  { name: 'context', register: registerContextIpcHandlers },
  { name: 'ai', register: registerAiIpcHandlers },
  { name: 'capturePolicy', register: registerCapturePolicyIpcHandlers },
  { name: 'visual', register: registerVisualIpcHandlers },
  { name: 'interview', register: registerInterviewIpcHandlers },
  { name: 'simulation', register: registerSimulationIpcHandlers },
];

/**
 * Clear known invoke handlers then register all domain handlers.
 *
 * Interview handlers (including `interview:pick-document`) are always
 * re-bound after other groups so an earlier group failure cannot leave
 * document upload broken.
 */
export function registerAllIpcHandlers(): void {
  for (const channel of Object.values(IpcChannels)) {
    ipcMain.removeHandler(channel);
  }

  const failed: string[] = [];
  for (const group of HANDLER_GROUPS) {
    try {
      group.register();
    } catch (error) {
      failed.push(group.name);
      logger.error('ipc.register_group_failed', {
        group: group.name,
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  // Product-critical: always (re)bind interview handlers last.
  try {
    registerInterviewIpcHandlers();
  } catch (error) {
    logger.error('ipc.interview_register_failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }

  logger.info('ipc.handlers_ready', {
    interviewPickDocument: IpcChannels.INTERVIEW_PICK_DOCUMENT,
    failedGroups: failed,
  });
}
