# MVP Stabilization (Phase 2K)

Reliability and lifecycle hardening for the end-to-end interview product flow.

## Product lifecycle

Prepare → Start Interview → Automatic listening → Question → Context → Automatic AI answer → Continue → Pause/Resume → End → Summary → New Interview

## Guarantees

- Clean startup: no mic / STT / visual / AI activity before Start Interview
- Start Interview begins listening automatically (no separate Start Listening step)
- Pause cancels active AI generation and disconnects STT; resume reconnects once
- End Interview stops STT, cancels AI/visual work, clears transient transcript state
- New Interview clears documents and pipeline state (no session A → B leakage)
- Visual / OCR / vision failures are non-fatal enhancements
- Failed document extraction is never treated as ready context
- Automated tests use MockAIProvider — no OpenAI/Deepgram network dependency

## External providers

OpenAI quota/billing failures are **external configuration**, not application bugs.
Use MockAIProvider for validation when live quota is unavailable.
