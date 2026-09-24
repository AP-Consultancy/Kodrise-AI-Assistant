import { DETECTION_CONFIDENCE } from '../../shared/questions/types';

export interface DetectionCandidate {
  text: string;
  detectionConfidence: number;
  isFollowUp: boolean;
  isClarification: boolean;
  isMultiPart: boolean;
  parts: string[];
  reason: string;
}

const QUESTION_WORD =
  /^(what|who|where|when|why|how|which|whose|whom)\b/i;

const AUX_INVERSION =
  /^(can|could|would|should|will|do|does|did|is|are|was|were|have|has|had|may|might)\b.+\b(you|we|i|they|it|this|that)\b/i;

const INTERVIEW_IMPERATIVE =
  /^(tell me|explain|describe|walk me through|talk (me )?about|give me an example|share|discuss)\b/i;

const FOLLOW_UP_START =
  /^(and |but |so |then )?(why|how|what about|how about|and why|and how|what else)\b/i;

const CLARIFICATION =
  /\b(what do you mean|can you clarify|could you clarify|can you explain that|what does that mean|clarify that)\b/i;

const FALSE_POSITIVE_RELATIVE =
  /^(what|who|where|when|why|how)\s+(i|we|they|he|she)\s+(learned|did|built|worked|saw|heard|meant|thought)\b/i;

const STATEMENT_START =
  /^(i |we |they |he |she |my |our |the |this |that |it |there was|there were)/i;

/**
 * Layered, rule-based question detector (no LLM).
 */
export class QuestionDetector {
  detect(rawText: string, options?: { hasRecentQuestion?: boolean }): DetectionCandidate[] {
    const text = rawText.trim();
    if (!text) {
      return [];
    }

    const sentences = this.splitSentences(text);
    const results: DetectionCandidate[] = [];

    for (const sentence of sentences) {
      const candidate = this.scoreSentence(sentence, options?.hasRecentQuestion ?? false);
      if (candidate.detectionConfidence >= DETECTION_CONFIDENCE.IGNORE_BELOW) {
        results.push(candidate);
      }
    }

    return results;
  }

  private splitSentences(text: string): string[] {
    // Prefer punctuation boundaries; also split when a new interrogative begins mid-string.
    const rough = text
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    const expanded: string[] = [];
    for (const part of rough) {
      const multi = part.split(
        /\s+(?=(?:and\s+)?(?:how|what|why|can you|could you|would you|tell me)\b)/i,
      );
      if (multi.length > 1 && multi.every((item) => item.trim().split(/\s+/).length >= 3)) {
        for (const item of multi) {
          const trimmed = item.trim().replace(/^and\s+/i, '');
          if (trimmed) {
            expanded.push(trimmed);
          }
        }
      } else {
        expanded.push(part);
      }
    }
    return expanded.length > 0 ? expanded : [text];
  }

  private scoreSentence(sentence: string, hasRecentQuestion: boolean): DetectionCandidate {
    const lower = sentence.toLowerCase().trim();
    let confidence: number = DETECTION_CONFIDENCE.NOT_QUESTION;
    const reasons: string[] = [];

    if (FALSE_POSITIVE_RELATIVE.test(lower)) {
      return {
        text: sentence,
        detectionConfidence: DETECTION_CONFIDENCE.NOT_QUESTION,
        isFollowUp: false,
        isClarification: false,
        isMultiPart: false,
        parts: [],
        reason: 'relative_clause_false_positive',
      };
    }

    const endsWithQuestionMark = /[?]$/.test(sentence.trim());
    if (endsWithQuestionMark) {
      confidence = Math.max(confidence, DETECTION_CONFIDENCE.STRONG_QUESTION);
      reasons.push('question_mark');
    }

    if (QUESTION_WORD.test(lower) && !FALSE_POSITIVE_RELATIVE.test(lower)) {
      confidence = Math.max(confidence, DETECTION_CONFIDENCE.STRONG_QUESTION);
      reasons.push('question_word');
    }

    if (AUX_INVERSION.test(lower)) {
      confidence = Math.max(confidence, DETECTION_CONFIDENCE.DEFINITE_QUESTION);
      reasons.push('aux_inversion');
    }

    if (INTERVIEW_IMPERATIVE.test(lower)) {
      confidence = Math.max(confidence, DETECTION_CONFIDENCE.LIKELY_QUESTION);
      reasons.push('interview_imperative');
    }

    if (/\b(can you|could you|would you|how did you|how would you|why did you)\b/i.test(lower)) {
      confidence = Math.max(confidence, DETECTION_CONFIDENCE.DEFINITE_QUESTION);
      reasons.push('direct_address');
    }

    const isClarification = CLARIFICATION.test(lower);
    if (isClarification) {
      confidence = Math.max(confidence, DETECTION_CONFIDENCE.DEFINITE_QUESTION);
      reasons.push('clarification');
    }

    const isFollowUp = FOLLOW_UP_START.test(lower) && hasRecentQuestion;
    if (isFollowUp) {
      confidence = Math.max(confidence, DETECTION_CONFIDENCE.LIKELY_QUESTION);
      reasons.push('follow_up');
    }

    if (STATEMENT_START.test(lower) && !QUESTION_WORD.test(lower) && !AUX_INVERSION.test(lower) && !INTERVIEW_IMPERATIVE.test(lower) && !endsWithQuestionMark) {
      confidence = Math.min(confidence, DETECTION_CONFIDENCE.WEAK);
      reasons.push('statement_shape');
    }

    // "I was wondering how ..." — soft interrogative
    if (/\b(i was wondering|i'm wondering|i wonder)\b.+\b(how|what|why|whether)\b/i.test(lower)) {
      confidence = Math.max(confidence, DETECTION_CONFIDENCE.LIKELY_QUESTION);
      reasons.push('wondering_clause');
    }

    // "The question is how ..." — context-dependent; treat as uncertain-to-likely
    if (/\b(the question is|my question is)\b/i.test(lower)) {
      confidence = Math.max(confidence, DETECTION_CONFIDENCE.UNCERTAIN + 0.1);
      reasons.push('meta_question');
    }

    const parts = this.extractMultiParts(sentence);
    const isMultiPart = parts.length > 1;
    if (isMultiPart) {
      confidence = Math.max(confidence, DETECTION_CONFIDENCE.STRONG_QUESTION);
      reasons.push('multi_part');
    }

    return {
      text: sentence,
      detectionConfidence: Math.min(1, Number(confidence.toFixed(3))),
      isFollowUp,
      isClarification,
      isMultiPart,
      parts: isMultiPart ? parts : [],
      reason: reasons.join(',') || 'none',
    };
  }

  private extractMultiParts(sentence: string): string[] {
    const lower = sentence.toLowerCase();
    const markers = (lower.match(/\b(how|what|why|can you|could you)\b/g) ?? []).length;
    if (markers < 2) {
      return [];
    }
    const parts = sentence
      .split(/\s*,\s*|\s+and\s+(?=how|what|why|can|could)/i)
      .map((part) => part.trim().replace(/^and\s+/i, ''))
      .filter((part) => part.split(/\s+/).length >= 3);
    return parts.length > 1 ? parts : [];
  }
}
