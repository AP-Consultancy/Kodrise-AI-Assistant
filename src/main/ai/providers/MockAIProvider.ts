import type {
  AIChunk,
  AIProviderCapabilities,
  AIProviderStatus,
  AIRequest,
} from '../../../shared/ai/types';
import { DEFAULT_MOCK_CAPABILITIES } from '../../../shared/ai/types';
import type { AIProvider } from '../../../core/ai/AIProvider';
import { AppError } from '../../../shared/errors';
import { getJavaInterviewDataset } from '../../../core/simulation/javaInterviewDataset';
import { matchJavaInterviewAnswer } from '../../../core/simulation/matchJavaInterviewAnswer';

export interface MockAIProviderOptions {
  model?: string;
  /** Delay between streamed chunks (ms). Default 30. */
  chunkDelayMs?: number;
}

/**
 * Deterministic streaming mock for tests and offline interview simulation.
 * Looks up Java interview dataset answers when the question matches.
 */
export class MockAIProvider implements AIProvider {
  private connected = false;
  private activeRequestId: string | null = null;
  private cancelled = new Set<string>();
  private readonly model: string;
  private readonly chunkDelayMs: number;

  constructor(options?: MockAIProviderOptions) {
    this.model = options?.model ?? 'mock-answer-v1';
    this.chunkDelayMs = options?.chunkDelayMs ?? 30;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.activeRequestId = null;
  }

  async cancel(requestId: string): Promise<void> {
    this.cancelled.add(requestId);
    if (this.activeRequestId === requestId) {
      this.activeRequestId = null;
    }
  }

  getCapabilities(): AIProviderCapabilities {
    return { ...DEFAULT_MOCK_CAPABILITIES };
  }

  getStatus(): AIProviderStatus {
    return {
      provider: 'mock',
      connected: this.connected,
      model: this.model,
      activeRequestId: this.activeRequestId,
      lastErrorCode: null,
    };
  }

  async *generate(request: AIRequest): AsyncIterable<AIChunk> {
    if (!this.connected) {
      throw new AppError('PROVIDER', 'Mock AI provider is not connected');
    }
    this.activeRequestId = request.requestId;
    const answer = this.buildAnswer(request);
    const parts = answer.match(/.{1,18}/g) ?? [answer];
    let sequence = 0;
    for (const part of parts) {
      if (this.cancelled.has(request.requestId)) {
        this.activeRequestId = null;
        return;
      }
      await delay(this.chunkDelayMs);
      yield {
        requestId: request.requestId,
        sequence: sequence++,
        text: part,
        isFinal: false,
      };
    }
    yield {
      requestId: request.requestId,
      sequence: sequence++,
      text: '',
      isFinal: true,
    };
    this.activeRequestId = null;
  }

  private buildAnswer(request: AIRequest): string {
    const system = request.messages.find((m) => m.role === 'system')?.content ?? '';
    if (system.includes('PROBLEM_INTELLIGENCE_V1')) {
      return this.buildProblemIntelligenceAnswer(request, system);
    }

    const matched = matchJavaInterviewAnswer(
      request.question.text,
      getJavaInterviewDataset(),
    );
    if (matched) {
      return matched.answer;
    }

    const mode = request.responseMode;
    const question = request.question.text;
    if (mode === 'short') {
      return `Short answer for: ${question}`;
    }
    if (mode === 'detailed') {
      return `Detailed answer for: ${question}. Explanation: use the provided context. Example: apply the same pattern in a similar service. Trade-off: more detail increases response length.`;
    }
    return `Normal answer for: ${question}. Brief explanation with context awareness.`;
  }

  private buildProblemIntelligenceAnswer(request: AIRequest, system: string): string {
    const user = request.messages.find((m) => m.role === 'user')?.content ?? '';
    if (/ignore previous|reveal (api|secret|key)|system prompt/i.test(user)) {
      // Prompt-injection attempts must not override system behavior.
      return JSON.stringify({
        algorithm: null,
        code: null,
        sql: null,
        explanation: 'Problem text treated as untrusted reference only; unsafe instructions ignored.',
        complexity: {
          timeComplexity: 'O(1)',
          spaceComplexity: 'O(1)',
          reasoning: 'No executable solution for injection attempts.',
        },
        testCases: [],
        rootCause: null,
        correctedCode: null,
      });
    }

    const isSql = /Problem type: sql/i.test(system) || /\bSELECT\b/i.test(user);
    if (isSql) {
      return JSON.stringify({
        algorithm: null,
        code: null,
        sql: 'SELECT id, name FROM Employees ORDER BY id;',
        explanation: 'Return employee rows ordered by id.',
        complexity: {
          timeComplexity: 'O(n log n)',
          spaceComplexity: 'O(n)',
          reasoning: 'Sort cost depends on engine plan.',
        },
        testCases: [],
        rootCause: null,
        correctedCode: null,
      });
    }

    const langMatch = system.match(/Target language:\s+(\w+)/i);
    const lang = langMatch?.[1] ?? 'python';
    let code = 'def solve(nums):\n    return nums\n';
    if (lang === 'java') {
      code = 'class Solution {\n  public int[] solve(int[] nums) { return nums; }\n}\n';
    } else if (lang === 'javascript' || lang === 'typescript') {
      code = 'function solve(nums) {\n  return nums;\n}\n';
    }

    return JSON.stringify({
      algorithm: 'Single pass over the input; O(n) time and O(1) extra space when possible.',
      code,
      sql: null,
      explanation: 'Mock structured solution for offline Problem Intelligence.',
      complexity: {
        timeComplexity: 'O(n)',
        spaceComplexity: 'O(1)',
        reasoning: 'Single linear scan.',
      },
      testCases: [
        { input: '[1,2,3]', expectedOutput: '[1,2,3]', description: 'Normal case' },
        { input: '[]', expectedOutput: '[]', description: 'Empty input' },
      ],
      rootCause: /debug/i.test(system) ? 'Off-by-one in loop bound.' : null,
      correctedCode: /debug/i.test(system) ? code : null,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
