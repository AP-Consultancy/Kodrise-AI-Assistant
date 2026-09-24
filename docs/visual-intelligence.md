# Visual Intelligence (Phase 2H)

OCR + vision analysis on top of Visual Context Foundation (Phase 2G).

## 1. Architecture

```
VisualCaptureProvider → VisualFrame
        ↓
  VisualIntelligencePipeline
        ├─ OCRProvider → OCRResult
        └─ VisionProvider → VisionAnalysis
        ↓
  VisualContextManager (stores summaries)
        ↓
  ContextSnapshot → AIOrchestrator → AIProvider (text)
```

Components stay separate:

- `VisualCaptureProvider` / `VisualContextManager` — capture + frame store
- `OCRProvider` — text extraction
- `VisionProvider` — structured scene analysis
- `VisualIntelligencePipeline` — orchestration, relevance, timeouts
- `ContextEngine` / `AIOrchestrator` — unchanged entry points

## 2. OCRProvider

Interface: `src/core/ocr/OCRProvider.ts`

- `getCapabilities()`
- `recognize(frame, requestId)`
- `cancel(requestId)`

Shared types: `src/shared/ocr/`

OCR results never store raw image bytes.

## 3. VisionProvider

Interface: `src/core/vision/VisionProvider.ts`

- `getCapabilities()`
- `analyze(VisionAnalysisRequest)`
- `cancel(requestId)`

Requests may include bounded OCR text, question text/type, and a short transcript slice — never the full transcript dump.

## 4. Mock providers

- `MockOCRProvider` — success / empty / failure / timeout / cancel
- `MockVisionProvider` — success / unknown / failure / timeout / cancel

Unit tests use mocks only (no network).

## 5. Real providers

Main-process OpenAI adapters:

- `src/main/ocr/OpenAIOCRProvider.ts`
- `src/main/vision/OpenAIVisionProvider.ts`

Both reuse CredentialVault key `ai.openai.apiKey`. No second credential store.

Without a key, capabilities report `NOT_CONFIGURED`.

## 6. Configuration

Public (non-secret) `visualIntelligence` block:

| Key | Default |
|-----|---------|
| `enabled` | `false` |
| `ocr.enabled` | `true` |
| `ocr.provider` | `openai` |
| `ocr.maxCharacters` | `4000` |
| `vision.enabled` | `true` |
| `vision.provider` | `openai` |
| `vision.model` | `gpt-4o-mini` |
| `maxAnalysisFrames` | `2` |
| `analysisTimeoutMs` | `45000` |
| `autoAnalyzeOnCapture` | `false` |
| `autoAnalyzeOnQuestion` | `true` |

Credentials are never placed in public config.

## 7. Question-aware analysis

`RuleBasedVisualRelevanceEvaluator` returns:

- `RELEVANT` — coding / architecture / technical (+ keyword heuristics)
- `NOT_RELEVANT` — behavioral / general without visual keywords
- `UNKNOWN` — no question or ambiguous

Irrelevant questions skip analysis unless `force` is set (manual Analyze).

## 8. Context integration

`VisualContextSnapshot` now includes:

- `ocrResults`
- `visionAnalyses`
- metadata counts + payload bytes

`ContextBuilder` priority (prompt order):

1. current question  
2. related/parent questions  
3. recent transcript  
4. visual analysis  
5. OCR text (deduped against vision)  
6. recent questions  
7. project context  
8. user context  

Visual text is budgeted and truncated with the existing context character budget.

Text-only AI generation is unchanged — visual evidence is injected as prompt text, not multimodal chat in `AIProvider`.

## 9. Performance

- Bounded OCR characters and analysis frame count
- Duplicate content-hash skip
- One active analysis per frame id
- Cancellable requests + timeouts
- Async main-process work (no renderer OCR/vision)

## 10. Error handling

Application codes (via `AppError.details.code`):

- `OCR_PROVIDER_UNAVAILABLE`, `OCR_NOT_CONFIGURED`, `OCR_PERMISSION_DENIED`, `OCR_TIMEOUT`, `OCR_FAILED`
- `VISION_PROVIDER_UNAVAILABLE`, `VISION_NOT_CONFIGURED`, `VISION_TIMEOUT`, `VISION_FAILED`, `VISION_UNSUPPORTED_IMAGE`
- `VISUAL_ANALYSIS_CANCELLED`

Raw SDK exceptions are not forwarded to the renderer.

## 11. Security

- OpenAI SDK stays in main process
- Renderer receives metadata/status DTOs only
- No image bytes in IPC events or logs
- No permanent screenshot persistence
- Same Electron isolation: `contextIsolation`, no `nodeIntegration`

## 12. Optional live tests

```
LIVE_VISUAL_AI_TESTS=true
OPENAI_API_KEY=...
npm test -- tests/integration/visual-intelligence.integration.test.ts
```

Default is off. CI must not require credits or network.

## 13. Provider limitations

- OpenAI OCR is vision-model text extraction, not a dedicated OCR engine (no reliable bounding boxes)
- Classification confidence can be low; `UNKNOWN` is preferred over fabrication
- Provider instances are created at host startup; changing provider id may require app restart

## 14. Future extensions

- Dedicated on-device OCR (e.g. Tesseract / Windows OCR)
- Multimodal answer generation via optional `MultimodalAIProvider`
- Smarter relevance models behind `VisualRelevanceEvaluator`
- Region-aware OCR bounding boxes when the provider supports them

## IPC

| Channel | Purpose |
|---------|---------|
| `visual.intelligence:get-capabilities` | OCR/vision capability DTOs |
| `visual.intelligence:get-status` | Runtime status |
| `visual.intelligence:analyze-current` | Force analyze latest frame |
| `visual.intelligence:cancel` | Cancel active request |
| `visual.intelligence:clear-results` | Clear OCR/vision summaries |

Events: `visual:ocr-*`, `visual:vision-*`, `visual:intelligence-updated` (metadata only).
