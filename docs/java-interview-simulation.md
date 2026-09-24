# Java interview simulation (Phase 2L-B)

Offline Mock AI practice mode with **60** Java / Spring Boot questions for a ~3 year experience profile.

## Execution modes

| Mode | Default | Microphone / Deepgram questions |
|------|---------|----------------------------------|
| `real` | yes | Drive the interview |
| `simulation` | — | **Isolated** — mic finals do not advance simulation or trigger AI |

Simulation uses `InterviewExecutionMode = "simulation"`, disables microphone question ingest, and injects questions via `submitSimulatedQuestion` (skips `QuestionDuplicateDetector`).

## How to use

1. Settings → **Use Mock AI** (simulation also switches to Mock AI automatically)
2. On the Live Interview screen, open **Interview Simulation** and click **Start Simulation**
3. Answer streams through Context Engine → MockAI (no OpenAI credits)
4. Click **Next Question** when ready (default: manual; optional auto-advance)
5. Use **Pause / Resume / Restart / End Simulation** as needed

## Pipeline

```
startSimulation()
  → Q01 (simulationQuestionId) + runtime UUID
  → ContextEngine / ContextBuilder
  → PromptBuilder
  → MockAIProvider (dataset answer)
  → streamed Answer UI
  → wait for Next Question (or auto-advance if enabled)
  → Q02 …
```

Deepgram STT and Phase 2L-A capture-policy are unchanged for **real** mode.
