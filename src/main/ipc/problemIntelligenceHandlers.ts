import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc/channels';
import {
  ProblemCancelExecutionSchema,
  ProblemCreateSchema,
  ProblemEventsLimitSchema,
  ProblemExecuteSchema,
  ProblemIdSchema,
  ProblemReviseSchema,
  ProblemSelectDialectSchema,
  ProblemSelectLanguageSchema,
} from '../../shared/ipc/schemas';
import { ValidationError } from '../../shared/errors';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';
import type {
  CreateProblemInput,
  ProgrammingLanguage,
  SqlDialect,
} from '../../shared/problem-intelligence/types';

export function registerProblemIntelligenceIpcHandlers(): void {
  ipcMain.handle(IpcChannels.PROBLEM_GET_STATUS, (event) =>
    handleIpc(IpcChannels.PROBLEM_GET_STATUS, event, () =>
      getAppServices().problemIntelligence.getStatus(),
    ),
  );

  ipcMain.handle(IpcChannels.PROBLEM_GET_CURRENT, (event) =>
    handleIpc(IpcChannels.PROBLEM_GET_CURRENT, event, () =>
      getAppServices().problemIntelligence.getCurrent(),
    ),
  );

  ipcMain.handle(IpcChannels.PROBLEM_GET_RESULT, (event, payload: unknown) =>
    handleIpc(IpcChannels.PROBLEM_GET_RESULT, event, () => {
      const parsed = ProblemIdSchema.safeParse(payload);
      if (!parsed.success) throw new ValidationError('Invalid problem id payload');
      return getAppServices().problemIntelligence.getResult(parsed.data.problemId);
    }),
  );

  ipcMain.handle(IpcChannels.PROBLEM_LIST, (event) =>
    handleIpc(IpcChannels.PROBLEM_LIST, event, () => getAppServices().problemIntelligence.list()),
  );

  ipcMain.handle(IpcChannels.PROBLEM_GET_EVENTS, (event, payload: unknown) =>
    handleIpc(IpcChannels.PROBLEM_GET_EVENTS, event, () => {
      const parsed = ProblemEventsLimitSchema.safeParse(payload ?? {});
      if (!parsed.success) throw new ValidationError('Invalid problem events payload');
      return getAppServices().problemIntelligence.getEvents(parsed.data?.limit);
    }),
  );

  ipcMain.handle(IpcChannels.PROBLEM_CREATE, (event, payload: unknown) =>
    handleIpc(IpcChannels.PROBLEM_CREATE, event, () => {
      const parsed = ProblemCreateSchema.safeParse(payload);
      if (!parsed.success) throw new ValidationError('Invalid problem create payload');
      const data = parsed.data;
      const input: CreateProblemInput = {
        text: data.text,
        source: data.source,
        language: normalizeLang(data.language),
        sqlDialect: normalizeDialect(data.sqlDialect),
        existingCode: data.existingCode,
        existingSql: data.existingSql,
        schema: data.schema,
        sampleData: data.sampleData,
        sessionLanguage: normalizeLang(data.sessionLanguage ?? undefined) as
          | ProgrammingLanguage
          | null
          | undefined,
      };
      if (data.sessionLanguage === null) input.sessionLanguage = null;
      return getAppServices().problemIntelligence.createAndSolve(input);
    }),
  );

  ipcMain.handle(IpcChannels.PROBLEM_SELECT_LANGUAGE, (event, payload: unknown) =>
    handleIpc(IpcChannels.PROBLEM_SELECT_LANGUAGE, event, () => {
      const parsed = ProblemSelectLanguageSchema.safeParse(payload);
      if (!parsed.success) throw new ValidationError('Invalid language selection payload');
      return getAppServices().problemIntelligence.selectLanguage({
        problemId: parsed.data.problemId,
        language: parsed.data.language as ProgrammingLanguage,
      });
    }),
  );

  ipcMain.handle(IpcChannels.PROBLEM_SELECT_DIALECT, (event, payload: unknown) =>
    handleIpc(IpcChannels.PROBLEM_SELECT_DIALECT, event, () => {
      const parsed = ProblemSelectDialectSchema.safeParse(payload);
      if (!parsed.success) throw new ValidationError('Invalid dialect selection payload');
      return getAppServices().problemIntelligence.selectDialect({
        problemId: parsed.data.problemId,
        dialect: parsed.data.dialect as SqlDialect,
      });
    }),
  );

  ipcMain.handle(IpcChannels.PROBLEM_REVISE, (event, payload: unknown) =>
    handleIpc(IpcChannels.PROBLEM_REVISE, event, () => {
      const parsed = ProblemReviseSchema.safeParse(payload);
      if (!parsed.success) throw new ValidationError('Invalid problem revise payload');
      return getAppServices().problemIntelligence.revise({
        problemId: parsed.data.problemId,
        constraintDelta: parsed.data.constraintDelta,
        language: normalizeLang(parsed.data.language),
        sqlDialect: normalizeDialect(parsed.data.sqlDialect),
      });
    }),
  );

  ipcMain.handle(IpcChannels.PROBLEM_EXECUTE, (event, payload: unknown) =>
    handleIpc(IpcChannels.PROBLEM_EXECUTE, event, () => {
      const parsed = ProblemExecuteSchema.safeParse(payload);
      if (!parsed.success) throw new ValidationError('Invalid problem execute payload');
      return getAppServices().problemIntelligence.execute(parsed.data);
    }),
  );

  ipcMain.handle(IpcChannels.PROBLEM_CANCEL_EXECUTION, (event, payload: unknown) =>
    handleIpc(IpcChannels.PROBLEM_CANCEL_EXECUTION, event, () => {
      const parsed = ProblemCancelExecutionSchema.safeParse(payload ?? {});
      if (!parsed.success) throw new ValidationError('Invalid cancel execution payload');
      return getAppServices().problemIntelligence.cancelExecution(parsed.data?.executionId);
    }),
  );

  ipcMain.handle(IpcChannels.PROBLEM_RESET, (event) =>
    handleIpc(IpcChannels.PROBLEM_RESET, event, () => {
      getAppServices().problemIntelligence.resetForSessionStop();
      return getAppServices().problemIntelligence.getStatus();
    }),
  );
}

function normalizeLang(
  value: string | null | undefined,
): ProgrammingLanguage | 'auto' | undefined {
  if (value == null) return undefined;
  if (value === 'auto') return 'auto';
  return value as ProgrammingLanguage;
}

function normalizeDialect(value: string | null | undefined): SqlDialect | 'auto' | undefined {
  if (value == null) return undefined;
  if (value === 'auto') return 'auto';
  return value as SqlDialect;
}
