import type { ProgrammingLanguage } from '../../shared/problem-intelligence/types';
import {
  executionError,
  type CodeExecutionProvider,
  type CodeExecutionRequest,
} from './CodeExecutionProvider';

/**
 * Deterministic sandbox stand-in.
 * Real OS/process sandbox providers plug in behind CodeExecutionProvider later.
 * Never uses eval / new Function / renderer Node APIs.
 */
export class MockCodeExecutionProvider implements CodeExecutionProvider {
  readonly name = 'mock-code';
  private readonly cancelled = new Set<string>();
  private readonly active = new Map<string, AbortController>();
  private concurrent = 0;
  private readonly maxConcurrent: number;

  constructor(options?: { maxConcurrent?: number }) {
    this.maxConcurrent = options?.maxConcurrent ?? 2;
  }

  isAvailable(): boolean {
    return true;
  }

  supportedLanguages(): ProgrammingLanguage[] {
    return ['python', 'javascript', 'typescript', 'java'];
  }

  async cancel(executionId: string): Promise<void> {
    this.cancelled.add(executionId);
    this.active.get(executionId)?.abort();
  }

  async execute(request: CodeExecutionRequest) {
    if (this.concurrent >= this.maxConcurrent) {
      return executionError('EXECUTION_FAILED', 'Maximum concurrent executions reached', {
        state: 'blocked',
      });
    }
    if (!this.supportedLanguages().includes(request.language) || request.language === 'unknown') {
      return executionError(
        'UNSUPPORTED_LANGUAGE',
        'This language is not currently supported.',
      );
    }

    const started = Date.now();
    this.concurrent += 1;
    const local = new AbortController();
    this.active.set(request.executionId, local);

    try {
      const timeout = Math.max(50, request.timeoutMs);
      const result = await Promise.race([
        this.simulate(request),
        new Promise<ReturnType<typeof executionError>>((resolve) => {
          const timer = setTimeout(() => {
            resolve(
              executionError('EXECUTION_TIMEOUT', 'Code execution timed out.', {
                durationMs: Date.now() - started,
              }),
            );
          }, timeout);
          const onAbort = () => {
            clearTimeout(timer);
            resolve(
              executionError('EXECUTION_CANCELLED', 'Execution was cancelled.', {
                durationMs: Date.now() - started,
              }),
            );
          };
          request.signal?.addEventListener('abort', onAbort, { once: true });
          local.signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);

      if (this.cancelled.has(request.executionId) || request.signal?.aborted) {
        return executionError('EXECUTION_CANCELLED', 'Execution was cancelled.', {
          durationMs: Date.now() - started,
        });
      }
      return { ...result, durationMs: result.durationMs ?? Date.now() - started };
    } finally {
      this.concurrent -= 1;
      this.active.delete(request.executionId);
      this.cancelled.delete(request.executionId);
    }
  }

  private async simulate(request: CodeExecutionRequest) {
    await delay(15);

    // Explicit timeout probe for tests
    if (/__FORCE_TIMEOUT__/i.test(request.code)) {
      await delay(request.timeoutMs + 20);
      return executionError('EXECUTION_TIMEOUT', 'Code execution timed out.');
    }

    if (/__FORCE_FAIL__/i.test(request.code)) {
      return executionError('EXECUTION_FAILED', 'Execution failed.');
    }

    let stdout = '';
    const printMatch =
      request.code.match(/print\((['"`])([\s\S]*?)\1\)/) ||
      request.code.match(/console\.log\((['"`])([\s\S]*?)\1\)/) ||
      request.code.match(/System\.out\.println\((['"`])([\s\S]*?)\1\)/);
    if (printMatch?.[2] != null) {
      stdout = printMatch[2];
    } else if (request.stdin) {
      stdout = `processed:${request.stdin}`;
    } else {
      stdout = 'ok';
    }

    let truncated = false;
    if (Buffer.byteLength(stdout, 'utf8') > request.maxOutputBytes) {
      stdout = stdout.slice(0, Math.max(0, request.maxOutputBytes));
      truncated = true;
      return {
        state: 'failed' as const,
        stdout,
        stderr: '',
        exitCode: 1,
        durationMs: null,
        errorCode: 'EXECUTION_OUTPUT_LIMIT' as const,
        errorMessage: 'Execution output exceeded the size limit.',
        truncated: true,
      };
    }

    // Giant output probe
    if (/__HUGE_OUTPUT__/i.test(request.code)) {
      const huge = 'x'.repeat(request.maxOutputBytes + 10);
      return {
        state: 'failed' as const,
        stdout: huge.slice(0, request.maxOutputBytes),
        stderr: '',
        exitCode: 1,
        durationMs: null,
        errorCode: 'EXECUTION_OUTPUT_LIMIT' as const,
        errorMessage: 'Execution output exceeded the size limit.',
        truncated: true,
      };
    }

    return {
      state: 'completed' as const,
      stdout,
      stderr: '',
      exitCode: 0,
      durationMs: null,
      errorCode: null,
      errorMessage: null,
      truncated,
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
