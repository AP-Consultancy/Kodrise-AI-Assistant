const FILLER_PATTERN =
  /\b(um+|uh+|erm+|like|you know|sort of|kind of|basically|actually)\b/gi;

const MULTI_SPACE = /\s+/g;
const DUP_PUNCT = /([?!.,]){2,}/g;
const STT_ARTIFACTS = /\b(inaudible|unintelligible|\[music\]|\[noise\])\b/gi;

export class QuestionNormalizer {
  normalize(text: string): { originalText: string; normalizedText: string } {
    const originalText = text;
    let normalized = text.trim();
    normalized = normalized.replace(STT_ARTIFACTS, ' ');
    normalized = normalized.replace(FILLER_PATTERN, ' ');
    normalized = normalized.replace(DUP_PUNCT, '$1');
    normalized = normalized.replace(MULTI_SPACE, ' ').trim();

    // Light casing: capitalize first letter only; preserve mid-sentence tech tokens.
    if (normalized.length > 0) {
      normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
    }

    // Ensure terminal ? for clear interrogatives that lost punctuation.
    if (!/[.!?]$/.test(normalized) && this.looksInterrogative(normalized)) {
      normalized = `${normalized}?`;
    }

    return { originalText, normalizedText: normalized };
  }

  private looksInterrogative(text: string): boolean {
    const lower = text.toLowerCase();
    return /^(what|who|where|when|why|how|which|whose|whom|can|could|would|should|do|does|did|is|are|was|were|have|has|had)\b/.test(
      lower,
    );
  }
}
