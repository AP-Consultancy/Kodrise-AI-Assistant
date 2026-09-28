import type { SqlDialect } from '../../shared/problem-intelligence/types';
import {
  sqlExecutionError,
  type SqlExecutionProvider,
  type SqlExecutionRequest,
} from './SqlExecutionProvider';

/**
 * Temporary in-memory SQL sandbox for interview/practice problems.
 * Never connects to external or production databases.
 * Supports sqlite + generic; rejects sqlserver/oracle/mysql/postgresql engines
 * when those dialects need vendor-specific semantics without a matching engine.
 */
export class MockSqlExecutionProvider implements SqlExecutionProvider {
  readonly name: string = 'mock-sql';
  private readonly cancelled = new Set<string>();

  isAvailable(): boolean {
    return true;
  }

  supportedDialects(): SqlDialect[] {
    return ['sqlite', 'generic'];
  }

  async cancel(executionId: string): Promise<void> {
    this.cancelled.add(executionId);
  }

  async execute(request: SqlExecutionRequest) {
    const started = Date.now();
    if (this.cancelled.has(request.executionId) || request.signal?.aborted) {
      return sqlExecutionError('EXECUTION_CANCELLED', 'Execution was cancelled.');
    }

    const dialect = request.dialect;
    if (dialect === 'sqlserver' || dialect === 'oracle' || dialect === 'mysql' || dialect === 'postgresql') {
      return sqlExecutionError(
        'DIALECT_UNSUPPORTED',
        'SQL dialect is not available for execution.',
        { durationMs: Date.now() - started },
      );
    }
    if (dialect === 'unknown') {
      return sqlExecutionError(
        'DIALECT_UNSUPPORTED',
        'SQL dialect is not available for execution.',
      );
    }

    if (!request.schema && !/from\s+dual/i.test(request.sql) && !/select\s+\d/i.test(request.sql)) {
      // Allow simple constant selects without schema
      if (!/^\s*select\s+/i.test(request.sql)) {
        return sqlExecutionError('SCHEMA_REQUIRED', 'Schema or sample data is required.');
      }
    }

    await delay(10);
    if (this.cancelled.has(request.executionId)) {
      return sqlExecutionError('EXECUTION_CANCELLED', 'Execution was cancelled.');
    }

    if (/__FORCE_TIMEOUT__/i.test(request.sql)) {
      await delay(request.timeoutMs + 20);
      return sqlExecutionError('EXECUTION_TIMEOUT', 'Code execution timed out.');
    }

    // Deterministic sample result for SELECT 1 / SELECT literals
    const literal = request.sql.match(/select\s+(\d+|['"][^'"]+['"])\s*(?:as\s+(\w+))?/i);
    if (literal) {
      const col = literal[2] ?? 'value';
      let value: string | number = literal[1]!;
      if (/^\d+$/.test(String(value))) value = Number(value);
      else value = String(value).replace(/^['"]|['"]$/g, '');
      return {
        state: 'completed' as const,
        table: {
          columns: [col],
          rows: [{ [col]: value }],
          rowCount: 1,
        },
        warnings: [],
        durationMs: Date.now() - started,
        errorCode: null,
        errorMessage: null,
      };
    }

    // If sample data mentions Employees, return a tiny table
    if (/employees/i.test(request.sql) || /employees/i.test(request.sampleData ?? '')) {
      return {
        state: 'completed' as const,
        table: {
          columns: ['id', 'name'],
          rows: [
            { id: 1, name: 'Ada' },
            { id: 2, name: 'Grace' },
          ],
          rowCount: 2,
        },
        warnings: ['Result generated from sandbox sample data — not a production database.'],
        durationMs: Date.now() - started,
        errorCode: null,
        errorMessage: null,
      };
    }

    return {
      state: 'completed' as const,
      table: {
        columns: ['result'],
        rows: [{ result: 'ok' }],
        rowCount: 1,
      },
      warnings: ['Executed in temporary sandbox only.'],
      durationMs: Date.now() - started,
      errorCode: null,
      errorMessage: null,
    };
  }
}

/** Alias documenting intended SQLite sandbox path for future native binding. */
export class SqliteSqlExecutionProvider extends MockSqlExecutionProvider {
  readonly name = 'sqlite-sql';

  supportedDialects(): SqlDialect[] {
    return ['sqlite', 'generic'];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
