import type {
  ProgrammingLanguage,
  ProblemType,
  SqlDialect,
} from '../../shared/problem-intelligence/types';

/**
 * Deterministic problem classification — no LLM certainty invented.
 */
export class ProblemClassifier {
  classify(text: string): ProblemType {
    const t = text.trim();
    if (!t) return 'unknown';

    if (this.isCodeOutput(t)) return 'code_output';
    if (this.isDebugging(t)) return 'debugging';
    if (this.isSystemDesign(t)) return 'system_design';
    if (this.isSql(t)) return 'sql';
    if (this.isDatabaseTheory(t)) return 'database';
    if (this.isFrontend(t)) return 'frontend';
    if (this.isBackend(t)) return 'backend';
    if (this.isCoding(t)) return 'coding';
    if (this.isAlgorithm(t)) return 'algorithm';
    if (this.isTheoretical(t)) return 'theoretical';
    return 'unknown';
  }

  detectLanguage(text: string): ProgrammingLanguage | null {
    const lower = text.toLowerCase();
    const patterns: Array<{ lang: ProgrammingLanguage; re: RegExp }> = [
      { lang: 'python', re: /\b(python|py)\b|\bi'?ll use python\b|\bin python\b|\blet'?s do (it )?in python\b/i },
      { lang: 'java', re: /\bjava\b(?!script)|\bi'?ll use java\b|\bin java\b|\blet'?s do (it )?in java\b/i },
      { lang: 'javascript', re: /\b(javascript|js)\b|\bin javascript\b|\bi'?ll use (js|javascript)\b/i },
      { lang: 'typescript', re: /\b(typescript|ts)\b|\bin typescript\b/i },
      { lang: 'cpp', re: /c\+\+|\bcpp\b/i },
      { lang: 'csharp', re: /c#|\bcsharp\b|\.net\b/i },
      { lang: 'go', re: /\b(golang|go lang)\b|\bin go\b(?!\s+to\b)/i },
      { lang: 'rust', re: /\brust\b|\bin rust\b/i },
      { lang: 'kotlin', re: /\bkotlin\b/i },
      { lang: 'php', re: /\bphp\b/i },
      { lang: 'ruby', re: /\bruby\b/i },
      { lang: 'swift', re: /\bswift\b/i },
    ];
    for (const { lang, re } of patterns) {
      if (re.test(lower)) return lang;
    }
    return null;
  }

  detectSqlDialect(text: string): SqlDialect | null {
    const lower = text.toLowerCase();
    if (/\b(sql\s*server|t-sql|mssql)\b/.test(lower)) return 'sqlserver';
    if (/\bpostgres(ql)?\b/.test(lower)) return 'postgresql';
    if (/\bmysql\b/.test(lower)) return 'mysql';
    if (/\boracle\b/.test(lower)) return 'oracle';
    if (/\bsqlite\b/.test(lower)) return 'sqlite';
    if (/\bgeneric\s+sql\b|\bansi\s+sql\b/.test(lower)) return 'generic';
    return null;
  }

  private isCodeOutput(t: string): boolean {
    return (
      /what will (this|the)(?:\s+\w+)?\s+(code|program|snippet|function)/i.test(t) ||
      /what (is|does) (the|this) (output|program return)/i.test(t) ||
      /what (does|will) this (print|return|output)/i.test(t) ||
      /predict the output/i.test(t) ||
      /what will this .+ code print/i.test(t)
    );
  }

  private isDebugging(t: string): boolean {
    return (
      /why (does|is|did) this (fail|crash|error)/i.test(t) ||
      /find the bug/i.test(t) ||
      /fix (this|the) (code|bug|error)/i.test(t) ||
      /(compiler|runtime|syntax) error/i.test(t) ||
      /debug (this|the)/i.test(t)
    );
  }

  private isSystemDesign(t: string): boolean {
    return (
      /design (a|an|the)\b/i.test(t) ||
      /how would you (architect|design|scale)/i.test(t) ||
      /system design/i.test(t) ||
      /url shortener|rate limiter|news feed|chat system/i.test(t)
    );
  }

  private isSql(t: string): boolean {
    if (
      /\b(select|insert|update|delete|join|group\s+by|having|window\s+function|cte|with\s+\w+\s+as)\b/i.test(
        t,
      )
    ) {
      return true;
    }
    return (
      /write (a |an )?(sql|query)/i.test(t) ||
      /what will (this|the) query (return|output)/i.test(t)
    );
  }

  private isDatabaseTheory(t: string): boolean {
    return (
      /\b(normalization|normal form|acid|isolation level|query plan|index(es)?|transaction|deadlock)\b/i.test(
        t,
      ) && !this.isSql(t)
    );
  }

  private isFrontend(t: string): boolean {
    return /\b(react|css|dom|browser|frontend|ui component|accessibility)\b/i.test(t);
  }

  private isBackend(t: string): boolean {
    return /\b(rest api|graphql|microservice|backend service|http endpoint)\b/i.test(t);
  }

  private isCoding(t: string): boolean {
    return (
      /write (a |an )?(function|method|class|program|code)/i.test(t) ||
      /\bimplement\b/i.test(t) ||
      /given an? (array|string|list|tree|graph|matrix)/i.test(t) ||
      /find the (longest|shortest|maximum|minimum)/i.test(t) ||
      /return the\b/i.test(t) ||
      /write (java|python|javascript|typescript|c\+\+|c#) code/i.test(t) ||
      /leetcode|coding (problem|challenge)/i.test(t)
    );
  }

  private isAlgorithm(t: string): boolean {
    return /\b(algorithm|big[- ]?o|time complexity|space complexity|dfs|bfs|dynamic programming)\b/i.test(
      t,
    );
  }

  private isTheoretical(t: string): boolean {
    return /^(what|why|how|explain|describe|compare)\b/i.test(t.trim());
  }
}
