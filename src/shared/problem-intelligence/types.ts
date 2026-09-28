/**
 * Problem Intelligence — provider-independent domain types.
 * Never include secrets in these DTOs.
 */

export type ProblemType =
  | 'coding'
  | 'sql'
  | 'code_output'
  | 'debugging'
  | 'algorithm'
  | 'database'
  | 'frontend'
  | 'backend'
  | 'system_design'
  | 'theoretical'
  | 'unknown';

export type ProgrammingLanguage =
  | 'python'
  | 'java'
  | 'javascript'
  | 'typescript'
  | 'cpp'
  | 'csharp'
  | 'go'
  | 'rust'
  | 'kotlin'
  | 'php'
  | 'ruby'
  | 'swift'
  | 'unknown';

export type SqlDialect =
  | 'postgresql'
  | 'mysql'
  | 'sqlserver'
  | 'oracle'
  | 'sqlite'
  | 'generic'
  | 'unknown';

export type ProblemSource = 'manual' | 'simulation' | 'visual_capture' | 'document' | 'pasted_text';

export type VerificationStatus =
  | 'not_verified'
  | 'generated'
  | 'executed'
  | 'partially_verified'
  | 'verified'
  | 'execution_unavailable'
  | 'execution_failed';

export type ExecutionState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'timed_out'
  | 'cancelled'
  | 'failed'
  | 'blocked'
  | 'unavailable';

export type ExecutionErrorCode =
  | 'EXECUTION_TIMEOUT'
  | 'EXECUTION_MEMORY_LIMIT'
  | 'EXECUTION_OUTPUT_LIMIT'
  | 'EXECUTION_PROVIDER_UNAVAILABLE'
  | 'EXECUTION_FAILED'
  | 'EXECUTION_CANCELLED'
  | 'UNSUPPORTED_LANGUAGE'
  | 'DIALECT_UNSUPPORTED'
  | 'SCHEMA_REQUIRED'
  | 'VALIDATION_FAILED';

export interface ComplexityAnalysis {
  timeComplexity: string;
  spaceComplexity: string;
  reasoning: string;
  uncertain?: boolean;
}

export interface ProblemTestCase {
  id: string;
  input: string;
  expectedOutput: string;
  description: string;
}

export interface CodeExecutionResult {
  state: ExecutionState;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number | null;
  errorCode: ExecutionErrorCode | null;
  errorMessage: string | null;
  truncated: boolean;
}

export interface SqlResultTable {
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  rowCount: number;
}

export interface SqlExecutionResult {
  state: ExecutionState;
  table: SqlResultTable | null;
  warnings: string[];
  durationMs: number | null;
  errorCode: ExecutionErrorCode | null;
  errorMessage: string | null;
}

export interface NormalizedProblem {
  title: string | null;
  statement: string;
  originalText: string;
  constraints: string[];
  inputFormat: string | null;
  outputFormat: string | null;
  examples: string[];
  existingCode: string | null;
  existingSql: string | null;
  language: ProgrammingLanguage;
  sqlDialect: SqlDialect;
  expectedTask: string | null;
  ambiguities: string[];
  schema: string | null;
  sampleData: string | null;
}

export interface ProblemRevision {
  revisionId: string;
  parentRevisionId: string | null;
  version: number;
  constraintDelta: string;
  createdAt: number;
  normalized: NormalizedProblem;
}

export interface ProblemSolutionPayload {
  algorithm: string | null;
  code: string | null;
  sql: string | null;
  explanation: string;
  rootCause: string | null;
  correctedCode: string | null;
}

export interface ProblemResult {
  problemId: string;
  type: ProblemType;
  source: ProblemSource;
  normalizedProblem: NormalizedProblem;
  language: ProgrammingLanguage;
  sqlDialect: SqlDialect;
  solution: ProblemSolutionPayload;
  explanation: string;
  complexity: ComplexityAnalysis | null;
  testCases: ProblemTestCase[];
  executionResult: CodeExecutionResult | null;
  sqlExecutionResult: SqlExecutionResult | null;
  verificationStatus: VerificationStatus;
  warnings: string[];
  revisionVersion: number;
  createdAt: number;
  updatedAt: number;
}

export type ProblemEventType =
  | 'PROBLEM_CREATED'
  | 'PROBLEM_CLASSIFIED'
  | 'LANGUAGE_SELECTED'
  | 'DIALECT_SELECTED'
  | 'SOLUTION_REQUESTED'
  | 'SOLUTION_GENERATED'
  | 'TESTS_GENERATED'
  | 'EXECUTION_STARTED'
  | 'EXECUTION_COMPLETED'
  | 'EXECUTION_FAILED'
  | 'COMPLEXITY_ANALYZED'
  | 'PROBLEM_REVISED'
  | 'VERIFICATION_COMPLETED';

export interface ProblemEvent {
  type: ProblemEventType;
  problemId: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export interface ProblemIntelligenceLimits {
  maxProblemHistory: number;
  maxRevisionsPerProblem: number;
  maxOutputBytes: number;
  maxTests: number;
  maxConcurrentExecutions: number;
  defaultTimeoutMs: number;
}

export const DEFAULT_PROBLEM_INTELLIGENCE_LIMITS: ProblemIntelligenceLimits = {
  maxProblemHistory: 50,
  maxRevisionsPerProblem: 10,
  maxOutputBytes: 100_000,
  maxTests: 50,
  maxConcurrentExecutions: 2,
  defaultTimeoutMs: 5_000,
};

export const PROGRAMMING_LANGUAGES: ProgrammingLanguage[] = [
  'python',
  'java',
  'javascript',
  'typescript',
  'cpp',
  'csharp',
  'go',
  'rust',
  'kotlin',
  'php',
  'ruby',
  'swift',
  'unknown',
];

export const SQL_DIALECTS: SqlDialect[] = [
  'postgresql',
  'mysql',
  'sqlserver',
  'oracle',
  'sqlite',
  'generic',
  'unknown',
];

export interface ProblemIntelligenceStatus {
  enabled: boolean;
  currentProblemId: string | null;
  problemCount: number;
  activeExecutionId: string | null;
  codeExecutionAvailable: boolean;
  sqlExecutionAvailable: boolean;
  supportedLanguages: ProgrammingLanguage[];
  supportedSqlDialects: SqlDialect[];
}

export interface CreateProblemInput {
  text: string;
  source?: ProblemSource;
  language?: ProgrammingLanguage | 'auto';
  sqlDialect?: SqlDialect | 'auto';
  existingCode?: string | null;
  existingSql?: string | null;
  schema?: string | null;
  sampleData?: string | null;
  sessionLanguage?: ProgrammingLanguage | null;
}

export interface ReviseProblemInput {
  problemId: string;
  constraintDelta: string;
  language?: ProgrammingLanguage | 'auto';
  sqlDialect?: SqlDialect | 'auto';
}

export interface SelectLanguageInput {
  problemId: string;
  language: ProgrammingLanguage;
}

export interface SelectDialectInput {
  problemId: string;
  dialect: SqlDialect;
}

export interface ExecuteProblemInput {
  problemId: string;
  mode?: 'solution' | 'existing' | 'tests';
}
