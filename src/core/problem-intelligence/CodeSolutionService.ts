import type { AIProvider } from '../ai/AIProvider';
import type { AIPromptMessage, AIRequest } from '../../shared/ai/types';
import type {
  ComplexityAnalysis,
  NormalizedProblem,
  ProblemSolutionPayload,
  ProblemTestCase,
  ProblemType,
  ProgrammingLanguage,
  SqlDialect,
} from '../../shared/problem-intelligence/types';
import { PromptBuilder } from '../prompts/PromptBuilder';
import type { DetectedQuestion } from '../../shared/questions/types';
import { DEFAULT_CONTEXT_BUDGET } from '../../shared/context/types';
import type { ContextSnapshot } from '../../shared/context/types';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';

export interface ParsedAiSolution {
  solution: ProblemSolutionPayload;
  complexity: ComplexityAnalysis | null;
  testCases: Array<{ input: string; expectedOutput: string; description: string }>;
  rawText: string;
}

/**
 * Generates coding / debugging / algorithm solutions via the shared AIProvider.
 */
export class CodeSolutionService {
  private readonly promptBuilder: PromptBuilder;
  private readonly createId: IdGenerator;

  constructor(options?: { promptBuilder?: PromptBuilder; idGenerator?: IdGenerator }) {
    this.promptBuilder = options?.promptBuilder ?? new PromptBuilder();
    this.createId = options?.idGenerator ?? createDefaultIdGenerator();
  }

  async generate(input: {
    provider: AIProvider;
    type: ProblemType;
    normalized: NormalizedProblem;
    language: ProgrammingLanguage;
    sqlDialect: SqlDialect;
    followUpConstraint?: string | null;
    sessionId?: string | null;
    correlationId?: string | null;
  }): Promise<ParsedAiSolution> {
    const messages = this.promptBuilder.buildProblemSolving({
      type: input.type,
      normalized: input.normalized,
      language: input.language,
      sqlDialect: input.sqlDialect,
      followUpConstraint: input.followUpConstraint,
    });

    const rawText = await this.streamText(input.provider, messages, {
      sessionId: input.sessionId ?? null,
      correlationId: input.correlationId ?? null,
      questionText: input.normalized.statement,
    });

    return this.parse(rawText, input.language, input.type);
  }

  parse(rawText: string, language: ProgrammingLanguage, type: ProblemType): ParsedAiSolution {
    const json = extractJson(rawText);
    if (json) {
      return {
        solution: {
          algorithm: asString(json.algorithm),
          code: asString(json.code) ?? asString(json.correctedCode),
          sql: asString(json.sql),
          explanation: asString(json.explanation) ?? 'Solution generated.',
          rootCause: asString(json.rootCause),
          correctedCode: asString(json.correctedCode),
        },
        complexity: json.complexity
          ? {
              timeComplexity: asString((json.complexity as Record<string, unknown>).timeComplexity) ?? 'O(n)',
              spaceComplexity:
                asString((json.complexity as Record<string, unknown>).spaceComplexity) ?? 'O(1)',
              reasoning:
                asString((json.complexity as Record<string, unknown>).reasoning) ??
                'Provided by model.',
              uncertain: true,
            }
          : null,
        testCases: Array.isArray(json.testCases)
          ? (json.testCases as Array<Record<string, unknown>>)
              .map((t) => ({
                input: asString(t.input) ?? '',
                expectedOutput: asString(t.expectedOutput) ?? '',
                description: asString(t.description) ?? 'Generated test',
              }))
              .filter((t) => t.input || t.expectedOutput)
          : [],
        rawText,
      };
    }

    // Deterministic fallback when provider returns plain text
    return {
      solution: {
        algorithm: type === 'coding' ? 'Iterate once and accumulate the result.' : null,
        code: language === 'unknown' ? null : fallbackCode(language, type),
        sql: null,
        explanation: rawText.slice(0, 4000) || 'Unable to generate a structured solution.',
        rootCause: type === 'debugging' ? 'Likely logical error in control flow.' : null,
        correctedCode: type === 'debugging' ? fallbackCode(language, 'coding') : null,
      },
      complexity: {
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        reasoning: 'Fallback estimate.',
        uncertain: true,
      },
      testCases: [],
      rawText,
    };
  }

  private async streamText(
    provider: AIProvider,
    messages: AIPromptMessage[],
    meta: { sessionId: string | null; correlationId: string | null; questionText: string },
  ): Promise<string> {
    const requestId = this.createId();
    const question = syntheticQuestion(meta.questionText);
    const context = emptyContext(question.id);
    const request: AIRequest = {
      requestId,
      sessionId: meta.sessionId,
      correlationId: meta.correlationId,
      question,
      context,
      responseMode: 'detailed',
      messages,
      metadata: {
        model: provider.getStatus().model,
        temperature: 0.2,
        maxOutputTokens: 2048,
        responseMode: 'detailed',
        provider: provider.getStatus().provider,
        contextId: context.id,
        questionId: question.id,
      },
    };

    let text = '';
    for await (const chunk of provider.generate(request)) {
      if (chunk.text) text += chunk.text;
    }
    return text;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fallbackCode(language: ProgrammingLanguage, type: ProblemType): string | null {
  if (language === 'unknown') return null;
  if (type === 'code_output') return null;
  if (language === 'python') {
    return 'def solve(nums):\n    """Interview solution sketch."""\n    return nums\n';
  }
  if (language === 'java') {
    return 'class Solution {\n  public int solve(int[] nums) {\n    return nums.length;\n  }\n}\n';
  }
  if (language === 'javascript' || language === 'typescript') {
    return 'function solve(nums) {\n  return nums;\n}\n';
  }
  return `// ${language} solution sketch\n`;
}

function syntheticQuestion(text: string): DetectedQuestion {
  return {
    id: 'problem-intel-q',
    text,
    originalText: text,
    normalizedText: text,
    type: 'coding',
    status: 'classified',
    timestamp: Date.now(),
    sourceSegmentIds: [],
    detectionConfidence: 1,
    classificationConfidence: 1,
    isMultiPart: false,
    parts: [],
    parentQuestionId: null,
    relatedQuestionId: null,
  };
}

function emptyContext(questionId: string): ContextSnapshot {
  const q = syntheticQuestion('problem');
  return {
    id: 'problem-intel-ctx',
    sessionId: null,
    correlationId: null,
    questionId,
    currentQuestion: q,
    recentTranscript: [],
    recentQuestions: [],
    relatedQuestions: [],
    userContext: null,
    projectContext: null,
    visualContext: null,
    interviewDocuments: null,
    createdAt: Date.now(),
    metadata: {
      truncated: false,
      omittedTranscriptSegments: 0,
      omittedQuestions: 0,
      omittedDocumentExcerpts: 0,
      documentTruncated: false,
      sources: [],
      characterCount: 0,
      budget: { ...DEFAULT_CONTEXT_BUDGET },
    },
    quality: {
      completeness: 0,
      transcriptCoverage: 0,
      relationshipCoverage: 0,
      truncated: false,
    },
  };
}

export type { ProblemTestCase };
