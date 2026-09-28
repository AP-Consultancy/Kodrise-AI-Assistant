import type {
  NormalizedProblem,
  ProblemEvent,
  ProblemIntelligenceLimits,
  ProblemResult,
  ProblemRevision,
  ProblemType,
  ProgrammingLanguage,
  SqlDialect,
  VerificationStatus,
} from '../../shared/problem-intelligence/types';
import { DEFAULT_PROBLEM_INTELLIGENCE_LIMITS } from '../../shared/problem-intelligence/types';
import type { IdGenerator } from '../../shared/session/types';
import { createDefaultIdGenerator } from '../../shared/session/types';

export interface ProblemRecord {
  problemId: string;
  type: ProblemType;
  source: ProblemResult['source'];
  language: ProgrammingLanguage;
  sqlDialect: SqlDialect;
  revisions: ProblemRevision[];
  result: ProblemResult | null;
  warnings: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Bounded in-memory problem session store.
 */
export class ProblemSession {
  private readonly createId: IdGenerator;
  private readonly limits: ProblemIntelligenceLimits;
  private readonly problems = new Map<string, ProblemRecord>();
  private readonly order: string[] = [];
  private currentProblemId: string | null = null;
  private readonly events: ProblemEvent[] = [];

  constructor(options?: {
    idGenerator?: IdGenerator;
    limits?: Partial<ProblemIntelligenceLimits>;
  }) {
    this.createId = options?.idGenerator ?? createDefaultIdGenerator();
    this.limits = { ...DEFAULT_PROBLEM_INTELLIGENCE_LIMITS, ...options?.limits };
  }

  getLimits(): ProblemIntelligenceLimits {
    return { ...this.limits };
  }

  getCurrentProblemId(): string | null {
    return this.currentProblemId;
  }

  getProblem(problemId: string): ProblemRecord | null {
    return this.problems.get(problemId) ?? null;
  }

  listProblems(): ProblemRecord[] {
    return this.order
      .map((id) => this.problems.get(id))
      .filter((p): p is ProblemRecord => Boolean(p));
  }

  create(input: {
    type: ProblemType;
    source: ProblemResult['source'];
    language: ProgrammingLanguage;
    sqlDialect: SqlDialect;
    normalized: NormalizedProblem;
    warnings: string[];
  }): ProblemRecord {
    const now = Date.now();
    const problemId = this.createId();
    const revision: ProblemRevision = {
      revisionId: this.createId(),
      parentRevisionId: null,
      version: 1,
      constraintDelta: '',
      createdAt: now,
      normalized: input.normalized,
    };
    const record: ProblemRecord = {
      problemId,
      type: input.type,
      source: input.source,
      language: input.language,
      sqlDialect: input.sqlDialect,
      revisions: [revision],
      result: null,
      warnings: [...input.warnings],
      createdAt: now,
      updatedAt: now,
    };
    this.problems.set(problemId, record);
    this.order.push(problemId);
    this.currentProblemId = problemId;
    this.trimHistory();
    return record;
  }

  revise(
    problemId: string,
    constraintDelta: string,
    normalized: NormalizedProblem,
  ): ProblemRecord {
    const record = this.require(problemId);
    if (record.revisions.length >= this.limits.maxRevisionsPerProblem) {
      throw new Error('Maximum revisions per problem reached');
    }
    const parent = record.revisions[record.revisions.length - 1]!;
    const revision: ProblemRevision = {
      revisionId: this.createId(),
      parentRevisionId: parent.revisionId,
      version: parent.version + 1,
      constraintDelta,
      createdAt: Date.now(),
      normalized,
    };
    record.revisions.push(revision);
    record.updatedAt = Date.now();
    return record;
  }

  setLanguage(problemId: string, language: ProgrammingLanguage): ProblemRecord {
    const record = this.require(problemId);
    record.language = language;
    const latest = record.revisions[record.revisions.length - 1]!;
    latest.normalized = { ...latest.normalized, language };
    record.updatedAt = Date.now();
    return record;
  }

  setDialect(problemId: string, dialect: SqlDialect): ProblemRecord {
    const record = this.require(problemId);
    record.sqlDialect = dialect;
    const latest = record.revisions[record.revisions.length - 1]!;
    latest.normalized = { ...latest.normalized, sqlDialect: dialect };
    record.updatedAt = Date.now();
    return record;
  }

  setResult(problemId: string, result: ProblemResult): ProblemRecord {
    const record = this.require(problemId);
    record.result = result;
    record.warnings = [...new Set([...record.warnings, ...result.warnings])];
    record.updatedAt = Date.now();
    return record;
  }

  setVerification(problemId: string, status: VerificationStatus): ProblemRecord {
    const record = this.require(problemId);
    if (record.result) {
      record.result = { ...record.result, verificationStatus: status, updatedAt: Date.now() };
    }
    record.updatedAt = Date.now();
    return record;
  }

  latestNormalized(problemId: string): NormalizedProblem {
    const record = this.require(problemId);
    return record.revisions[record.revisions.length - 1]!.normalized;
  }

  pushEvent(event: ProblemEvent): void {
    this.events.push(event);
    while (this.events.length > this.limits.maxProblemHistory * 4) {
      this.events.shift();
    }
  }

  getEvents(limit = 100): ProblemEvent[] {
    return this.events.slice(-limit);
  }

  reset(): void {
    this.problems.clear();
    this.order.length = 0;
    this.events.length = 0;
    this.currentProblemId = null;
  }

  private require(problemId: string): ProblemRecord {
    const record = this.problems.get(problemId);
    if (!record) throw new Error('Problem not found');
    return record;
  }

  private trimHistory(): void {
    while (this.order.length > this.limits.maxProblemHistory) {
      const oldest = this.order.shift();
      if (oldest) this.problems.delete(oldest);
    }
  }
}
