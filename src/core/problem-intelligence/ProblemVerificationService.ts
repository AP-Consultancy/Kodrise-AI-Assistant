import type {
  CodeExecutionResult,
  ProblemType,
  SqlExecutionResult,
  VerificationStatus,
} from '../../shared/problem-intelligence/types';

/**
 * Maps generation + execution outcomes to verification status.
 */
export class ProblemVerificationService {
  fromGenerationOnly(type: ProblemType): VerificationStatus {
    if (type === 'theoretical' || type === 'system_design' || type === 'database') {
      return 'generated';
    }
    return 'generated';
  }

  fromCodeExecution(
    type: ProblemType,
    execution: CodeExecutionResult | null,
    inferred: boolean,
  ): VerificationStatus {
    if (!execution) {
      return inferred ? 'execution_unavailable' : 'generated';
    }
    if (execution.state === 'unavailable') return 'execution_unavailable';
    if (execution.state === 'timed_out' || execution.state === 'failed' || execution.state === 'cancelled') {
      return 'execution_failed';
    }
    if (execution.state === 'completed') {
      if (type === 'code_output') return 'verified';
      return 'executed';
    }
    return 'partially_verified';
  }

  fromSqlExecution(execution: SqlExecutionResult | null): VerificationStatus {
    if (!execution) return 'generated';
    if (execution.state === 'unavailable') return 'execution_unavailable';
    if (execution.state === 'timed_out' || execution.state === 'failed' || execution.state === 'cancelled') {
      return 'execution_failed';
    }
    if (execution.state === 'completed') return 'executed';
    return 'partially_verified';
  }

  combine(
    generation: VerificationStatus,
    execution: VerificationStatus,
  ): VerificationStatus {
    if (execution === 'verified') return 'verified';
    if (execution === 'executed') return 'executed';
    if (execution === 'execution_failed') return 'execution_failed';
    if (execution === 'execution_unavailable') return 'execution_unavailable';
    if (execution === 'partially_verified') return 'partially_verified';
    return generation;
  }
}
