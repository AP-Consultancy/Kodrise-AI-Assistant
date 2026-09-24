import type { QuestionType } from '../../shared/questions/types';
import { QUESTION_TYPE_PRIORITY } from '../../shared/questions/types';

export interface ClassificationResult {
  type: QuestionType;
  classificationConfidence: number;
  matchedSignals: string[];
}

interface Rule {
  type: QuestionType;
  weight: number;
  test: (text: string) => boolean;
  signal: string;
}

const RULES: Rule[] = [
  {
    type: 'coding',
    weight: 0.95,
    signal: 'coding_keywords',
    test: (t) =>
      /\b(write a (function|method|class)|implement|reverse a linked list|binary tree|leetcode|algorithm|complexity|big[- ]?o|pseudocode|code sample)\b/.test(
        t,
      ),
  },
  {
    type: 'system_design',
    weight: 0.95,
    signal: 'system_design_keywords',
    test: (t) =>
      /\b(design (a|an|the)|url shortener|rate limiter|news feed|chat system|distributed|scalability|system design|high availability|cap theorem)\b/.test(
        t,
      ),
  },
  {
    type: 'architecture',
    weight: 0.9,
    signal: 'architecture_keywords',
    test: (t) =>
      /\b(architecture|microservices|monolith|event[- ]driven|hexagonal|clean architecture|cqrs|domain[- ]driven)\b/.test(
        t,
      ),
  },
  {
    type: 'database',
    weight: 0.92,
    signal: 'database_keywords',
    test: (t) =>
      /\b(postgres|postgresql|mysql|mongodb|redis|sql|nosql|index|schema|normalization|orm|prisma|query plan)\b/.test(
        t,
      ),
  },
  {
    type: 'cloud',
    weight: 0.9,
    signal: 'cloud_keywords',
    test: (t) =>
      /\b(aws|azure|gcp|cloud|lambda|s3|ec2|kubernetes|k8s|ecs|cloudformation|terraform)\b/.test(t) &&
      /\b(deploy|host|scale|provision|infrastructure|cloud)\b/.test(t),
  },
  {
    type: 'devops',
    weight: 0.88,
    signal: 'devops_keywords',
    test: (t) =>
      /\b(ci\/cd|pipeline|docker|kubernetes|k8s|jenkins|github actions|deploy|observability|prometheus|grafana|helm)\b/.test(
        t,
      ),
  },
  {
    type: 'frontend',
    weight: 0.88,
    signal: 'frontend_keywords',
    test: (t) =>
      /\b(react|vue|angular|css|html|dom|frontend|front-end|ui|ux|browser|webpack|vite)\b/.test(t),
  },
  {
    type: 'backend',
    weight: 0.88,
    signal: 'backend_keywords',
    test: (t) =>
      /\b(backend|back-end|api|rest|graphql|express|nestjs|spring|django|fastapi|server[- ]side)\b/.test(
        t,
      ),
  },
  {
    type: 'ai_ml',
    weight: 0.9,
    signal: 'ai_ml_keywords',
    test: (t) =>
      /\b(machine learning|deep learning|neural|llm|transformer|embedding|model training|pytorch|tensorflow|nlp|computer vision)\b/.test(
        t,
      ),
  },
  {
    type: 'behavioral',
    weight: 0.9,
    signal: 'behavioral_keywords',
    test: (t) =>
      /\b(conflict|teammate|disagreement|leadership|feedback|strength|weakness|tell me about a time|challenging situation|worked with)\b/.test(
        t,
      ),
  },
  {
    type: 'project',
    weight: 0.82,
    signal: 'project_keywords',
    test: (t) =>
      /\b(your (current )?project|side project|portfolio|chose|decision|trade[- ]?off|why did you (choose|pick|use))\b/.test(
        t,
      ),
  },
  {
    type: 'technical',
    weight: 0.75,
    signal: 'technical_keywords',
    test: (t) =>
      /\b(dependency injection|stateless|concurrency|thread|memory|cache|protocol|oauth|jwt|authentication|authorization|encryption)\b/.test(
        t,
      ),
  },
  {
    // Definitional / concept questions without a domain keyword still belong in
    // the technical interview bucket (deterministic — not LLM).
    type: 'technical',
    weight: 0.7,
    signal: 'definitional_technical',
    test: (t) =>
      /\b(what (is|are|does|do)\b|tell me what\b|can you (tell me|explain) what\b|explain what\b)/.test(
        t,
      ) || /\b(what is|what's)\s+[a-z0-9][\w.+#/-]*\b/.test(t),
  },
  {
    type: 'clarification',
    weight: 0.95,
    signal: 'clarification_phrase',
    test: (t) =>
      /\b(what do you mean|can you clarify|could you clarify|explain that|what does .+ mean)\b/.test(t),
  },
  {
    type: 'follow_up',
    weight: 0.7,
    signal: 'follow_up_phrase',
    test: (t) => /^(and |but |so )?(why|how|what about|how about)\b/.test(t),
  },
  {
    type: 'general',
    weight: 0.55,
    signal: 'general_interview',
    test: (t) => /\b(tell me about yourself|introduce yourself|background|experience)\b/.test(t),
  },
];

/**
 * Deterministic keyword/phrase classifier (no LLM).
 * Uses QUESTION_TYPE_PRIORITY when multiple rules match with similar weight.
 */
export class QuestionClassifier {
  classify(
    text: string,
    hints?: { isFollowUp?: boolean; isClarification?: boolean; isMultiPart?: boolean },
  ): ClassificationResult {
    const lower = text.toLowerCase();
    const matches: Array<{ type: QuestionType; weight: number; signal: string }> = [];

    if (hints?.isClarification) {
      matches.push({ type: 'clarification', weight: 0.96, signal: 'hint_clarification' });
    }
    if (hints?.isFollowUp) {
      matches.push({ type: 'follow_up', weight: 0.85, signal: 'hint_follow_up' });
    }
    if (hints?.isMultiPart) {
      matches.push({ type: 'multi_part', weight: 0.8, signal: 'hint_multi_part' });
    }

    for (const rule of RULES) {
      if (rule.test(lower)) {
        matches.push({ type: rule.type, weight: rule.weight, signal: rule.signal });
      }
    }

    if (matches.length === 0) {
      return { type: 'unknown', classificationConfidence: 0.35, matchedSignals: [] };
    }

    matches.sort((a, b) => {
      if (b.weight !== a.weight) {
        return b.weight - a.weight;
      }
      return QUESTION_TYPE_PRIORITY.indexOf(a.type) - QUESTION_TYPE_PRIORITY.indexOf(b.type);
    });

    const best = matches[0]!;
    // If follow_up/clarification/multi_part won only via weak hint and a domain rule is stronger, prefer domain.
    if (
      (best.type === 'follow_up' || best.type === 'multi_part') &&
      matches.some((match) => match.weight >= 0.88 && !['follow_up', 'multi_part', 'clarification'].includes(match.type))
    ) {
      const domain = matches.find(
        (match) => match.weight >= 0.88 && !['follow_up', 'multi_part', 'clarification'].includes(match.type),
      )!;
      return {
        type: domain.type,
        classificationConfidence: domain.weight,
        matchedSignals: matches.map((match) => match.signal),
      };
    }

    return {
      type: best.type,
      classificationConfidence: best.weight,
      matchedSignals: matches.map((match) => match.signal),
    };
  }
}
