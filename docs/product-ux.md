# Product UX — Phase 2I

Primary product experience on top of Phases 2A–2H.

## Workflow

```
Prepare Session → Start Interview → Auto listen → Question → Context → Answer → End → Summary
```

## Navigation

Primary shell destinations:

- **Interview** — single workflow destination (not separate Prepare / Interview tabs)
- **Settings** — credentials + Advanced Diagnostics

Workflow views inside **Interview** are driven by `InterviewHost` phase (`prepare` → `live` → `summary`). Live is never shown unless phase is `live`.

## Screens

- **Prepare Session** — upload resume / JD / additional docs, Start Interview
- **Live Interview** — shown automatically after Start Interview; question + streaming answer, Pause / End / Regenerate / paste question
- **Session Summary** — shown after End Interview; duration, counts, New Interview → Prepare
- **Settings** — credential configured status (never shows secrets), Advanced Diagnostics entry
- **Advanced Diagnostics** — existing engineering panels unchanged

## Automatic start

`interview.start` enables `ai.autoGenerate`, enables visual intelligence auto-analyze-on-question, starts session, then the renderer starts microphone capture automatically.

## Documents

Provider-independent extractors for TXT/MD/PDF/DOCX. Bounded excerpts feed `ContextSnapshot.interviewDocuments`.

## Visual

Phase 2H runs automatically when relevant. Failures are non-fatal.
