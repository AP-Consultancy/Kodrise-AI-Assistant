# Question Understanding — Phase 2C

> Input: finalized `TranscriptSegment`s  
> Output: structured `DetectedQuestion`s  
> No LLM, no answers, no network calls in this layer

---

## Pipeline

```
Final TranscriptSegment
        ↓
QuestionTranscriptBuffer   (combine short related finals)
        ↓
QuestionDetector           (heuristics, no "?-only" rule)
        ↓
QuestionNormalizer         (whitespace / fillers / light punctuation)
        ↓
QuestionClassifier         (keyword / phrase rules + priority)
        ↓
DuplicateDetector
        ↓
QuestionContext (bounded)
        ↓
Typed events → IPC → UI
```

Orchestrated by `QuestionManager` in `src/core/questions/`.

---

## Detection strategy

**Layer 1 — linguistic heuristics**

- Question words (`what/how/why/…`)
- Auxiliary inversion (`can you`, `did you`)
- Interview imperatives (`tell me about`, `walk me through`)
- Clarification phrases
- Optional trailing `?` (bonus, not required)

**Layer 2 — conversation context**

- Follow-up starters when a recent question exists
- Parent/related question ids

**Layer 3 — classifier abstraction**

- Deterministic `QuestionClassifier` (replaceable later)
- No LLM in Phase 2C

False-positive controls reject relative clauses like “What I learned…” and plain statements.

Confidence constants live in `DETECTION_CONFIDENCE`.

---

## Classification priority

When multiple categories match, precedence is:

`coding → system_design → architecture → database → cloud → devops → frontend → backend → ai_ml → behavioral → project → technical → follow_up → clarification → multi_part → general → unknown`

This is **ambiguity resolution only**, not quality ranking.

Detection confidence and classification confidence are tracked separately.

---

## Buffering & duplicates

- Buffer merges nearby finals within time/length limits before detection.
- Incomplete stems (e.g. “Can you explain”) wait for more segments.
- Duplicates use token Jaccard similarity + source-segment overlap inside a time window.

---

## IPC / preload

```
window.companyAI.questions.getRecent()
window.companyAI.questions.getCurrent()
window.companyAI.questions.clear()
window.companyAI.questions.getStatus()
window.companyAI.questions.onDetected / onClassified / onUpdated
```

Session stop → `QuestionManager.resetForSessionStop()` (disable + clear).  
Session start / audio start re-enables processing.

---

## Logging

Metadata only: `questionId`, confidences, classification, session/correlation ids.  
Question text and transcript bodies are not logged by default.

---

## Limitations

1. Heuristic detector — not perfect NLP
2. English-oriented patterns
3. No semantic embeddings / LLM re-ranking
4. Multi-part splitting is best-effort
5. No answer generation (Phase 2D+)
