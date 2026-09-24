import { IpcChannels } from '../../shared/ipc/channels';
import {
  InterviewPickDocumentSchema,
  InterviewRemoveDocumentSchema,
  InterviewSubmitQuestionSchema,
} from '../../shared/ipc/schemas';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';
import { registerIpcHandle } from './registerIpcHandle';

export function registerInterviewIpcHandlers(): void {
  registerIpcHandle(IpcChannels.INTERVIEW_GET_STATUS, (event) =>
    handleIpc(IpcChannels.INTERVIEW_GET_STATUS, event, () =>
      getAppServices().interview.getStatus(),
    ),
  );

  registerIpcHandle(IpcChannels.INTERVIEW_GET_DOCUMENTS, (event) =>
    handleIpc(IpcChannels.INTERVIEW_GET_DOCUMENTS, event, () =>
      getAppServices().interview.getDocuments(),
    ),
  );

  registerIpcHandle(IpcChannels.INTERVIEW_PICK_DOCUMENT, (event, payload: unknown) =>
    handleIpc(IpcChannels.INTERVIEW_PICK_DOCUMENT, event, () => {
      const parsed = InterviewPickDocumentSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid document upload request');
      }
      return getAppServices().interview.pickAndAddDocument(parsed.data.kind);
    }),
  );

  registerIpcHandle(IpcChannels.INTERVIEW_REMOVE_DOCUMENT, (event, payload: unknown) =>
    handleIpc(IpcChannels.INTERVIEW_REMOVE_DOCUMENT, event, () => {
      const parsed = InterviewRemoveDocumentSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid document remove request');
      }
      return getAppServices().interview.removeDocument(parsed.data.id);
    }),
  );

  registerIpcHandle(IpcChannels.INTERVIEW_START, (event) =>
    handleIpc(IpcChannels.INTERVIEW_START, event, () =>
      getAppServices().interview.startInterview(),
    ),
  );

  registerIpcHandle(IpcChannels.INTERVIEW_MARK_LISTENING, (event) =>
    handleIpc(IpcChannels.INTERVIEW_MARK_LISTENING, event, () =>
      getAppServices().interview.markListeningActive(),
    ),
  );

  registerIpcHandle(IpcChannels.INTERVIEW_PAUSE, (event) =>
    handleIpc(IpcChannels.INTERVIEW_PAUSE, event, () =>
      getAppServices().interview.pauseInterview(),
    ),
  );

  registerIpcHandle(IpcChannels.INTERVIEW_RESUME, (event) =>
    handleIpc(IpcChannels.INTERVIEW_RESUME, event, () =>
      getAppServices().interview.resumeInterview(),
    ),
  );

  registerIpcHandle(IpcChannels.INTERVIEW_END, (event) =>
    handleIpc(IpcChannels.INTERVIEW_END, event, () => getAppServices().interview.endInterview()),
  );

  registerIpcHandle(IpcChannels.INTERVIEW_NEW, (event) =>
    handleIpc(IpcChannels.INTERVIEW_NEW, event, () => getAppServices().interview.newInterview()),
  );

  registerIpcHandle(IpcChannels.INTERVIEW_SUBMIT_QUESTION, (event, payload: unknown) =>
    handleIpc(IpcChannels.INTERVIEW_SUBMIT_QUESTION, event, () => {
      const parsed = InterviewSubmitQuestionSchema.safeParse(payload);
      if (!parsed.success) {
        throw new ValidationError('Invalid question text');
      }
      return getAppServices().interview.submitManualQuestion(parsed.data.text);
    }),
  );

  registerIpcHandle(IpcChannels.INTERVIEW_REGENERATE, (event) =>
    handleIpc(IpcChannels.INTERVIEW_REGENERATE, event, () =>
      getAppServices().interview.regenerate(),
    ),
  );
}
