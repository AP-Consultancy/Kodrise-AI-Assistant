# Problem Intelligence

Provider-independent subsystem for structured interview coding / SQL problem solving.

## Architecture

```
UI (Problem Solver panel)
  → preload / typed IPC
  → ProblemIntelligenceHost (main)
  → ProblemIntelligenceOrchestrator (core)
       ├─ ProblemClassifier / ProblemExtractor / ProblemSession
       ├─ PromptBuilder.buildProblemSolving()  (untrusted problem text)
       ├─ AIProvider (same factory as interview: Mock / OpenAI / Gemini)
       ├─ CodeSolutionService / SqlSolutionService
       ├─ ComplexityAnalyzer / TestCaseGenerator
       ├─ ProblemExecutionService
       │     ├─ MockCodeExecutionProvider (pluggable sandbox)
       │     └─ MockSqlExecutionProvider / SqliteSqlExecutionProvider
       └─ ProblemVerificationService
```

Existing `AIOrchestrator`, Context Engine, STT, Visual Intelligence, and capture policy are unchanged. Problem Intelligence **reuses** the shared AI provider factory — it does not open a second OpenAI/Gemini client path.

## Problem lifecycle

1. **Create** — manual / simulation / pasted text / future explicit visual capture
2. **Classify** — deterministic type detection (`coding`, `sql`, `code_output`, …)
3. **Normalize** — structured fields + warnings for missing constraints/language
4. **Language / dialect** — explicit user selection always wins; otherwise session language / unknown (never silent Python)
5. **Solve** — AI structured JSON via `PromptBuilder.buildProblemSolving`
6. **Tests / complexity** — generated heuristics + model output
7. **Execute** (optional / auto for output questions) — sandboxed providers
8. **Verify** — status reflects what actually ran
9. **Revise** — follow-up constraints create versioned revisions without destroying v1

## Verification model

| Status | Meaning |
|--------|---------|
| `not_verified` | No solution yet |
| `generated` | AI/heuristic solution only |
| `executed` | Sandbox ran successfully |
| `verified` | Output question matched sandbox stdout |
| `partially_verified` | Mixed / uncertain complexity |
| `execution_unavailable` | Sandbox missing or dialect unsupported |
| `execution_failed` | Timeout / crash / cancelled |

Inferred answers must **not** be labeled `verified`.

## Code execution security boundary

- No `eval` / `new Function`
- No renderer Node access
- No execution inside Electron main via arbitrary shell for user code (mock provider today)
- Limits: timeout, output bytes, concurrency, cancellation
- Real OS/process sandbox is pluggable behind `CodeExecutionProvider`

## SQL execution

- Temporary sandbox only — **never** user production databases
- Supported execution dialects today: `sqlite`, `generic`
- `sqlserver` / `mysql` / `postgresql` / `oracle` → `DIALECT_UNSUPPORTED` (AI may still explain)

## Supported languages (execution)

Mock sandbox: `python`, `java`, `javascript`, `typescript`  
Others may still receive AI solutions with `UNSUPPORTED_LANGUAGE` on execute.

## UI

Settings → Advanced Diagnostics → **Problem Solver** panel (glass / reading-zone materials).

## Limitations

- Mock code/SQL execution is deterministic and limited (not a full language runtime)
- No automatic monitoring of meetings, chat apps, clipboard, or screens
- Complexity analysis is heuristic unless a future verifier is added

## Future providers

- Firecracker / gVisor / Docker-backed `CodeExecutionProvider`
- Native SQLite / Postgres testcontainers for dialect-accurate SQL
- Explicit user-triggered screenshot → `ProblemSource: visual_capture`
