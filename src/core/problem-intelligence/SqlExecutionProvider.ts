import type {
  SqlDialect,
  SqlExecutionResult,
} from '../../shared/problem-intelligence/types';
import type { ExecutionErrorCode } from '../../shared/problem-intelligence/types';

export interface SqlExecutionRequest {
  executionId: string;
  dialect: SqlDialect;
  sql: string;
  schema?: string | null;
  sampleData?: string | null;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

/**
 * Sandbox SQL execution — never connect to production databases.
 */
export interface SqlExecutionProvider {
  readonly name: string;
  isAvailable(): boolean;
  supportedDialects(): SqlDialect[];
  execute(request: SqlExecutionRequest): Promise<SqlExecutionResult>;
  cancel(executionId: string): Promise<void>;
}

export function sqlExecutionError(
  code: ExecutionErrorCode,
  message: string,
  partial?: Partial<SqlExecutionResult>,
): SqlExecutionResult {
  return {
    state:
      code === 'EXECUTION_TIMEOUT'
        ? 'timed_out'
        : code === 'EXECUTION_CANCELLED'
          ? 'cancelled'
          : code === 'DIALECT_UNSUPPORTED' || code === 'EXECUTION_PROVIDER_UNAVAILABLE'
            ? 'unavailable'
            : 'failed',
    table: null,
    warnings: [],
    durationMs: partial?.durationMs ?? null,
    errorCode: code,
    errorMessage: message,
    ...partial,
  };
}
