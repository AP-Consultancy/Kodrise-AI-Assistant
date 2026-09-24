# Question detection validation (Phase 2L-A)

## Finding

Live Deepgram sessions could emit multiple `is_final` chunks inside one spoken utterance. The adapter previously treated every `is_final` as an utterance boundary, so progressive fragments each became a `DetectedQuestion`.

`unknown` + `classificationConfidence = 0.35` was the **correct classifier fallback** when no domain keyword matched (e.g. definitional “what is Java?”). That was not a duplicate bug by itself.

## Fixes

1. **Deepgram utterance boundary** — with interim results, FINAL is emitted on `speech_final`, punctuated `is_final`, or `is_final` when interims are off. Soft `is_final` updates stay PARTIAL.
2. **Progressive extension dedupe** — prefix/extension of a recent question updates or ignores instead of creating a new ID.
3. **Buffer** — progressive re-sends replace pending text; early flush without punctuation is stricter.
4. **Classifier** — definitional patterns (`what is`, `tell me what`, …) map to `technical` at 0.7 (still deterministic, no LLM).

## Safe logs only

`question.detected` / `question.classified` log ids, confidences, session/correlation ids — not full transcript text.
