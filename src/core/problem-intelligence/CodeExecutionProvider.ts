import type {
  CodeExecutionResult,
  ExecutionErrorCode,
  ProgrammingLanguage,
} from '../../shared/problem-intelligence/types';

export interface CodeExecutionRequest {
  executionId: string;
  language: ProgrammingLanguage;
  code: string;
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

/**
 * Sandbox boundary for code execution.
 * Implementations must NOT run in the renderer or via eval/new Function.
 */
export interface CodeExecutionProvider {
  readonly name: string;
  isAvailable(): boolean;
  supportedLanguages(): ProgrammingLanguage[];
  execute(request: CodeExecutionRequest): Promise<CodeExecutionResult>;
  cancel(executionId: string): Promise<void>;
}

export function executionError(
  code: ExecutionErrorCode,
  message: string,
  partial?: Partial<CodeExecutionResult>,
): CodeExecutionResult {
  return {
    state:
      code === 'EXECUTION_TIMEOUT'
        ? 'timed_out'
        : code === 'EXECUTION_CANCELLED'
          ? 'cancelled'
          : code === 'EXECUTION_PROVIDER_UNAVAILABLE' || code === 'UNSUPPORTED_LANGUAGE'
            ? 'unavailable'
            : 'failed',
    stdout: '',
    stderr: '',
    exitCode: null,
    durationMs: partial?.durationMs ?? null,
    errorCode: code,
    errorMessage: message,
    truncated: false,
    ...partial,
  };
}
