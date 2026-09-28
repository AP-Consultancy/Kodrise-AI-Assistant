import type {
  CodeExecutionResult,
  ProblemResult,
  SqlExecutionResult,
} from '../../shared/problem-intelligence/types';
import type { CodeExecutionProvider } from './CodeExecutionProvider';
import type { SqlExecutionProvider } from './SqlExecutionProvider';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';

/**
 * Coordinates sandboxed code/SQL execution with concurrency + cancellation.
 */
export class ProblemExecutionService {
  private readonly code: CodeExecutionProvider;
  private readonly sql: SqlExecutionProvider;
  private readonly createId: IdGenerator;
  private readonly maxOutputBytes: number;
  private readonly defaultTimeoutMs: number;
  private activeExecutionId: string | null = null;
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(options: {
    codeProvider: CodeExecutionProvider;
    sqlProvider: SqlExecutionProvider;
    idGenerator?: IdGenerator;
    maxOutputBytes?: number;
    defaultTimeoutMs?: number;
  }) {
    this.code = options.codeProvider;
    this.sql = options.sqlProvider;
    this.createId = options.idGenerator ?? createDefaultIdGenerator();
    this.maxOutputBytes = options.maxOutputBytes ?? 100_000;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;
  }

  getActiveExecutionId(): string | null {
    return this.activeExecutionId;
  }

  codeAvailable(): boolean {
    return this.code.isAvailable();
  }

  sqlAvailable(): boolean {
    return this.sql.isAvailable();
  }

  supportedCodeLanguages() {
    return this.code.supportedLanguages();
  }

  supportedSqlDialects() {
    return this.sql.supportedDialects();
  }

  async cancel(executionId?: string): Promise<void> {
    const id = executionId ?? this.activeExecutionId;
    if (!id) return;
    this.abortControllers.get(id)?.abort();
    await Promise.allSettled([this.code.cancel(id), this.sql.cancel(id)]);
  }

  async executeCode(input: {
    language: ProblemResult['language'];
    code: string;
    stdin?: string;
    timeoutMs?: number;
  }): Promise<{ executionId: string; result: CodeExecutionResult }> {
    const executionId = this.createId();
    const controller = new AbortController();
    this.abortControllers.set(executionId, controller);
    this.activeExecutionId = executionId;
    try {
      if (!this.code.isAvailable()) {
        return {
          executionId,
          result: {
            state: 'unavailable',
            stdout: '',
            stderr: '',
            exitCode: null,
            durationMs: null,
            errorCode: 'EXECUTION_PROVIDER_UNAVAILABLE',
            errorMessage: 'Execution was unavailable, so the result could not be verified.',
            truncated: false,
          },
        };
      }
      const result = await this.code.execute({
        executionId,
        language: input.language,
        code: input.code,
        stdin: input.stdin,
        timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
        maxOutputBytes: this.maxOutputBytes,
        signal: controller.signal,
      });
      return { executionId, result };
    } finally {
      this.abortControllers.delete(executionId);
      if (this.activeExecutionId === executionId) this.activeExecutionId = null;
    }
  }

  async executeSql(input: {
    dialect: ProblemResult['sqlDialect'];
    sql: string;
    schema?: string | null;
    sampleData?: string | null;
    timeoutMs?: number;
  }): Promise<{ executionId: string; result: SqlExecutionResult }> {
    const executionId = this.createId();
    const controller = new AbortController();
    this.abortControllers.set(executionId, controller);
    this.activeExecutionId = executionId;
    try {
      if (!this.sql.isAvailable()) {
        return {
          executionId,
          result: {
            state: 'unavailable',
            table: null,
            warnings: [],
            durationMs: null,
            errorCode: 'EXECUTION_PROVIDER_UNAVAILABLE',
            errorMessage: 'Execution was unavailable, so the result could not be verified.',
          },
        };
      }
      const result = await this.sql.execute({
        executionId,
        dialect: input.dialect,
        sql: input.sql,
        schema: input.schema,
        sampleData: input.sampleData,
        timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
        maxOutputBytes: this.maxOutputBytes,
        signal: controller.signal,
      });
      return { executionId, result };
    } finally {
      this.abortControllers.delete(executionId);
      if (this.activeExecutionId === executionId) this.activeExecutionId = null;
    }
  }
}
