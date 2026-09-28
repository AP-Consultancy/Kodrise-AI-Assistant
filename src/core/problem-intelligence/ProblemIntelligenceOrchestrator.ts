import type { AIProvider } from '../ai/AIProvider';
import type {
  CreateProblemInput,
  ExecuteProblemInput,
  ProblemIntelligenceStatus,
  ProblemResult,
  ProblemSolutionPayload,
  ProgrammingLanguage,
  ReviseProblemInput,
  SelectDialectInput,
  SelectLanguageInput,
  SqlDialect,
  VerificationStatus,
} from '../../shared/problem-intelligence/types';
import { ProblemClassifier } from './ProblemClassifier';
import { ProblemExtractor } from './ProblemExtractor';
import { ProblemSession } from './ProblemSession';
import { ProblemEventBus } from './ProblemEventBus';
import { CodeSolutionService } from './CodeSolutionService';
import { SqlSolutionService } from './SqlSolutionService';
import { ComplexityAnalyzer } from './ComplexityAnalyzer';
import { TestCaseGenerator } from './TestCaseGenerator';
import { ProblemExecutionService } from './ProblemExecutionService';
import { ProblemVerificationService } from './ProblemVerificationService';
import { MockCodeExecutionProvider } from './MockCodeExecutionProvider';
import { MockSqlExecutionProvider } from './MockSqlExecutionProvider';
import { PromptBuilder } from '../prompts/PromptBuilder';
import { AppError } from '../../shared/errors';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';

export interface ProblemIntelligenceOrchestratorOptions {
  getAIProvider: () => Promise<AIProvider>;
  sessionId?: () => string | null;
  correlationId?: () => string | null;
  idGenerator?: IdGenerator;
  promptBuilder?: PromptBuilder;
  execution?: ProblemExecutionService;
}

/**
 * Provider-independent Problem Intelligence facade.
 * Uses shared AIProvider (same Gemini/OpenAI/Mock factory) via PromptBuilder.
 */
export class ProblemIntelligenceOrchestrator {
  private readonly classifier = new ProblemClassifier();
  private readonly extractor = new ProblemExtractor();
  private readonly session: ProblemSession;
  private readonly events = new ProblemEventBus();
  private readonly codeSolutions: CodeSolutionService;
  private readonly sqlSolutions: SqlSolutionService;
  private readonly complexity = new ComplexityAnalyzer();
  private readonly tests: TestCaseGenerator;
  private readonly execution: ProblemExecutionService;
  private readonly verification = new ProblemVerificationService();
  private readonly getAIProvider: () => Promise<AIProvider>;
  private readonly sessionId: () => string | null;
  private readonly correlationId: () => string | null;
  private readonly createId: IdGenerator;
  private enabled = true;

  constructor(options: ProblemIntelligenceOrchestratorOptions) {
    this.createId = options.idGenerator ?? createDefaultIdGenerator();
    this.session = new ProblemSession({ idGenerator: this.createId });
    const promptBuilder = options.promptBuilder ?? new PromptBuilder();
    this.codeSolutions = new CodeSolutionService({
      promptBuilder,
      idGenerator: this.createId,
    });
    this.sqlSolutions = new SqlSolutionService({ codeSolutions: this.codeSolutions });
    this.tests = new TestCaseGenerator({
      idGenerator: this.createId,
      maxTests: this.session.getLimits().maxTests,
    });
    this.execution =
      options.execution ??
      new ProblemExecutionService({
        codeProvider: new MockCodeExecutionProvider({
          maxConcurrent: this.session.getLimits().maxConcurrentExecutions,
        }),
        sqlProvider: new MockSqlExecutionProvider(),
        idGenerator: this.createId,
        maxOutputBytes: this.session.getLimits().maxOutputBytes,
        defaultTimeoutMs: this.session.getLimits().defaultTimeoutMs,
      });
    this.getAIProvider = options.getAIProvider;
    this.sessionId = options.sessionId ?? (() => null);
    this.correlationId = options.correlationId ?? (() => null);
  }

  subscribe(listener: (event: import('../../shared/problem-intelligence/types').ProblemEvent) => void) {
    return this.events.subscribe(listener);
  }

  getStatus(): ProblemIntelligenceStatus {
    return {
      enabled: this.enabled,
      currentProblemId: this.session.getCurrentProblemId(),
      problemCount: this.session.listProblems().length,
      activeExecutionId: this.execution.getActiveExecutionId(),
      codeExecutionAvailable: this.execution.codeAvailable(),
      sqlExecutionAvailable: this.execution.sqlAvailable(),
      supportedLanguages: this.execution.supportedCodeLanguages(),
      supportedSqlDialects: this.execution.supportedSqlDialects(),
    };
  }

  getCurrentResult(): ProblemResult | null {
    const id = this.session.getCurrentProblemId();
    if (!id) return null;
    return this.session.getProblem(id)?.result ?? null;
  }

  getResult(problemId: string): ProblemResult | null {
    return this.session.getProblem(problemId)?.result ?? null;
  }

  listResults(): ProblemResult[] {
    return this.session
      .listProblems()
      .map((p) => p.result)
      .filter((r): r is ProblemResult => Boolean(r));
  }

  getEvents(limit = 100) {
    return this.session.getEvents(limit);
  }

  resetForSessionStop(): void {
    void this.execution.cancel();
    this.session.reset();
  }

  async createAndSolve(input: CreateProblemInput): Promise<ProblemResult> {
    if (!this.enabled) {
      throw new AppError('CONFIGURATION', 'Problem Intelligence is disabled');
    }
    const text = input.text?.trim();
    if (!text) {
      throw new AppError('VALIDATION', 'Problem text is required');
    }

    // Prompt-injection content must remain untrusted reference — classifier still runs on raw text.
    const type = this.classifier.classify(text);
    const explicitLang =
      input.language && input.language !== 'auto'
        ? input.language
        : this.classifier.detectLanguage(text);
    const language: ProgrammingLanguage =
      explicitLang ?? input.sessionLanguage ?? 'unknown';

    const explicitDialect =
      input.sqlDialect && input.sqlDialect !== 'auto'
        ? input.sqlDialect
        : this.classifier.detectSqlDialect(text);
    const sqlDialect: SqlDialect = explicitDialect ?? 'unknown';

    const { normalized, warnings } = this.extractor.extract({
      text,
      language,
      sqlDialect,
      existingCode: input.existingCode,
      existingSql: input.existingSql,
      schema: input.schema,
      sampleData: input.sampleData,
    });

    const record = this.session.create({
      type,
      source: input.source ?? 'manual',
      language,
      sqlDialect,
      normalized: { ...normalized, language, sqlDialect },
      warnings,
    });

    this.emit('PROBLEM_CREATED', record.problemId, { type, source: record.source });
    this.emit('PROBLEM_CLASSIFIED', record.problemId, { type });
    if (language !== 'unknown') {
      this.emit('LANGUAGE_SELECTED', record.problemId, { language });
    }
    if (sqlDialect !== 'unknown') {
      this.emit('DIALECT_SELECTED', record.problemId, { sqlDialect });
    }

    return this.solve(record.problemId);
  }

  async selectLanguage(input: SelectLanguageInput): Promise<ProblemResult> {
    this.session.setLanguage(input.problemId, input.language);
    this.emit('LANGUAGE_SELECTED', input.problemId, { language: input.language });
    return this.solve(input.problemId);
  }

  async selectDialect(input: SelectDialectInput): Promise<ProblemResult> {
    this.session.setDialect(input.problemId, input.dialect);
    this.emit('DIALECT_SELECTED', input.problemId, { dialect: input.dialect });
    return this.solve(input.problemId);
  }

  async revise(input: ReviseProblemInput): Promise<ProblemResult> {
    const record = this.session.getProblem(input.problemId);
    if (!record) throw new AppError('VALIDATION', 'Problem not found');

    const latest = this.session.latestNormalized(input.problemId);
    const mergedText = `${latest.originalText}\n\nFollow-up: ${input.constraintDelta}`;
    let language = record.language;
    let sqlDialect = record.sqlDialect;

    if (input.language && input.language !== 'auto') {
      language = input.language;
    } else {
      language = this.classifier.detectLanguage(input.constraintDelta) ?? language;
    }
    if (input.sqlDialect && input.sqlDialect !== 'auto') {
      sqlDialect = input.sqlDialect;
    } else {
      sqlDialect = this.classifier.detectSqlDialect(input.constraintDelta) ?? sqlDialect;
    }

    const { normalized, warnings } = this.extractor.extract({
      text: mergedText,
      language,
      sqlDialect,
      existingCode: latest.existingCode,
      existingSql: latest.existingSql,
      schema: latest.schema,
      sampleData: latest.sampleData,
    });

    // Preserve original statement; append constraint as revision delta only.
    normalized.statement = latest.statement;
    normalized.originalText = latest.originalText;
    normalized.constraints = [
      ...latest.constraints,
      input.constraintDelta.trim(),
    ].filter(Boolean);
    normalized.language = language;
    normalized.sqlDialect = sqlDialect;

    this.session.revise(input.problemId, input.constraintDelta, normalized);
    if (language !== record.language) this.session.setLanguage(input.problemId, language);
    if (sqlDialect !== record.sqlDialect) this.session.setDialect(input.problemId, sqlDialect);
    record.warnings.push(...warnings);
    this.emit('PROBLEM_REVISED', input.problemId, {
      constraintDelta: input.constraintDelta,
      version: this.session.getProblem(input.problemId)!.revisions.length,
    });
    return this.solve(input.problemId, input.constraintDelta);
  }

  async execute(input: ExecuteProblemInput): Promise<ProblemResult> {
    const record = this.session.getProblem(input.problemId);
    if (!record?.result) throw new AppError('VALIDATION', 'Solve the problem before executing');
    const result = record.result;
    this.emit('EXECUTION_STARTED', input.problemId, {});

    try {
      if (record.type === 'sql' || record.type === 'database') {
        const sql = result.solution.sql;
        if (!sql) {
          throw new AppError('VALIDATION', 'No SQL solution to execute');
        }
        const { result: sqlResult } = await this.execution.executeSql({
          dialect: record.sqlDialect,
          sql,
          schema: result.normalizedProblem.schema,
          sampleData: result.normalizedProblem.sampleData,
        });
        const verification = this.verification.fromSqlExecution(sqlResult);
        const next: ProblemResult = {
          ...result,
          sqlExecutionResult: sqlResult,
          verificationStatus: verification,
          warnings: [
            ...result.warnings,
            ...(sqlResult.errorMessage && sqlResult.state === 'unavailable'
              ? [sqlResult.errorMessage]
              : []),
          ],
          updatedAt: Date.now(),
        };
        this.session.setResult(input.problemId, next);
        this.emit(
          sqlResult.state === 'completed' ? 'EXECUTION_COMPLETED' : 'EXECUTION_FAILED',
          input.problemId,
          { state: sqlResult.state, errorCode: sqlResult.errorCode },
        );
        this.emit('VERIFICATION_COMPLETED', input.problemId, { verificationStatus: verification });
        return next;
      }

      const code =
        input.mode === 'existing'
          ? result.normalizedProblem.existingCode
          : result.solution.correctedCode ?? result.solution.code;
      if (!code) {
        throw new AppError('VALIDATION', 'No code to execute');
      }
      const { result: execResult } = await this.execution.executeCode({
        language: record.language,
        code,
      });
      const verification = this.verification.fromCodeExecution(record.type, execResult, false);
      const next: ProblemResult = {
        ...result,
        executionResult: execResult,
        verificationStatus: verification,
        warnings: [
          ...result.warnings,
          ...(execResult.state === 'unavailable'
            ? ['Execution unavailable — result inferred from code analysis.']
            : []),
        ],
        updatedAt: Date.now(),
      };
      this.session.setResult(input.problemId, next);
      this.emit(
        execResult.state === 'completed' ? 'EXECUTION_COMPLETED' : 'EXECUTION_FAILED',
        input.problemId,
        { state: execResult.state, errorCode: execResult.errorCode },
      );
      this.emit('VERIFICATION_COMPLETED', input.problemId, { verificationStatus: verification });
      return next;
    } catch (error) {
      this.emit('EXECUTION_FAILED', input.problemId, {
        message: error instanceof Error ? error.message : 'Execution failed',
      });
      throw error instanceof AppError
        ? error
        : new AppError('INTERNAL', 'Unable to execute the solution.', { recoverable: true });
    }
  }

  async cancelExecution(executionId?: string): Promise<ProblemIntelligenceStatus> {
    await this.execution.cancel(executionId);
    return this.getStatus();
  }

  private async solve(problemId: string, followUpConstraint?: string): Promise<ProblemResult> {
    const record = this.session.getProblem(problemId);
    if (!record) throw new AppError('VALIDATION', 'Problem not found');
    const normalized = this.session.latestNormalized(problemId);
    this.emit('SOLUTION_REQUESTED', problemId, { type: record.type });

    let solution: ProblemSolutionPayload;
    let aiTests: Array<{ input: string; expectedOutput: string; description: string }> = [];
    let complexity = this.complexity.fromNormalized(normalized);
    const warnings = [...record.warnings];

    try {
      const provider = await this.getAIProvider();
      await provider.connect();

      if (record.type === 'sql') {
        const sql = await this.sqlSolutions.generate({
          provider,
          type: record.type,
          normalized,
          language: record.language,
          sqlDialect: record.sqlDialect,
          followUpConstraint,
          sessionId: this.sessionId(),
          correlationId: this.correlationId(),
        });
        solution = sql.solution;
      } else {
        const parsed = await this.codeSolutions.generate({
          provider,
          type: record.type,
          normalized,
          language: record.language,
          sqlDialect: record.sqlDialect,
          followUpConstraint,
          sessionId: this.sessionId(),
          correlationId: this.correlationId(),
        });
        solution = parsed.solution;
        aiTests = parsed.testCases;
        if (parsed.complexity) complexity = parsed.complexity;
      }
    } catch {
      warnings.push('Unable to generate a solution.');
      solution = {
        algorithm: null,
        code: null,
        sql: null,
        explanation: 'Unable to generate a solution.',
        rootCause: null,
        correctedCode: null,
      };
    }

    complexity = this.complexity.analyze({
      type: record.type,
      algorithm: solution.algorithm,
      code: solution.code ?? solution.correctedCode,
      explanation: solution.explanation,
    });
    this.emit('COMPLEXITY_ANALYZED', problemId, {
      timeComplexity: complexity.timeComplexity,
      spaceComplexity: complexity.spaceComplexity,
    });

    const testCases = this.tests.generate({
      type: record.type,
      normalized,
      aiTests,
    });
    this.emit('TESTS_GENERATED', problemId, { count: testCases.length });
    this.emit('SOLUTION_GENERATED', problemId, { type: record.type });

    let verificationStatus: VerificationStatus = this.verification.fromGenerationOnly(record.type);
    let executionResult = null;
    let sqlExecutionResult = null;

    // Auto-execute code_output / sql output questions when possible
    if (record.type === 'code_output' && normalized.existingCode && record.language !== 'unknown') {
      this.emit('EXECUTION_STARTED', problemId, { mode: 'output' });
      const { result } = await this.execution.executeCode({
        language: record.language,
        code: normalized.existingCode,
      });
      executionResult = result;
      if (result.state === 'unavailable' || result.state === 'failed') {
        warnings.push('Execution unavailable — result inferred from code analysis.');
        verificationStatus = 'execution_unavailable';
        if (!solution.explanation || solution.explanation === 'Unable to generate a solution.') {
          solution = {
            ...solution,
            explanation: 'Inferred output from code analysis (not verified by execution).',
          };
        }
      } else {
        verificationStatus = this.verification.fromCodeExecution(record.type, result, false);
        if (result.stdout && !solution.explanation.includes(result.stdout)) {
          solution = {
            ...solution,
            explanation: `Output:\n${result.stdout}\n\n${solution.explanation}`,
          };
        }
      }
      this.emit(
        result.state === 'completed' ? 'EXECUTION_COMPLETED' : 'EXECUTION_FAILED',
        problemId,
        { state: result.state },
      );
    } else if (
      (record.type === 'sql' || normalized.expectedTask === 'predict_output') &&
      (solution.sql || normalized.existingSql)
    ) {
      const sqlText = solution.sql ?? normalized.existingSql!;
      this.emit('EXECUTION_STARTED', problemId, { mode: 'sql' });
      const { result } = await this.execution.executeSql({
        dialect: record.sqlDialect,
        sql: sqlText,
        schema: normalized.schema,
        sampleData: normalized.sampleData,
      });
      sqlExecutionResult = result;
      verificationStatus = this.verification.fromSqlExecution(result);
      if (result.state === 'unavailable') {
        warnings.push(
          result.errorMessage ?? 'SQL dialect is not available for execution.',
        );
      }
      this.emit(
        result.state === 'completed' ? 'EXECUTION_COMPLETED' : 'EXECUTION_FAILED',
        problemId,
        { state: result.state, errorCode: result.errorCode },
      );
    }

    if (complexity.uncertain && verificationStatus === 'verified') {
      verificationStatus = 'partially_verified';
    }

    const now = Date.now();
    const problemResult: ProblemResult = {
      problemId,
      type: record.type,
      source: record.source,
      normalizedProblem: normalized,
      language: record.language,
      sqlDialect: record.sqlDialect,
      solution,
      explanation: solution.explanation,
      complexity,
      testCases,
      executionResult,
      sqlExecutionResult,
      verificationStatus,
      warnings: [...new Set(warnings)],
      revisionVersion: record.revisions.length,
      createdAt: record.createdAt,
      updatedAt: now,
    };

    this.session.setResult(problemId, problemResult);
    this.emit('VERIFICATION_COMPLETED', problemId, { verificationStatus });
    return problemResult;
  }

  private emit(
    type: Parameters<ProblemEventBus['emit']>[0],
    problemId: string,
    payload?: Record<string, unknown>,
  ): void {
    const event = this.events.emit(type, problemId, payload);
    this.session.pushEvent(event);
  }
}
