# Architecture — AP AI Assistance Tool

> **Status:** Phase 2K MVP stabilization complete (lifecycle reliability, cleanup, MockAI E2E, session isolation). Phase 2J document intelligence and Phase 2I product UX remain in place. Engineering diagnostics under Settings → Advanced Diagnostics.  
> **Project root:** `D:\AP AI assistance tool`  
> **Inputs:** `REFERENCE_ANALYSIS.md` + enterprise target architecture  
> **Relationship to reference:** Independent greenfield product. The reference repository is study-only and is not a dependency, submodule, or code source for this project.

---

## 1. Purpose

Internal company desktop AI assistant that:

- Captures **screen** and **audio** (with explicit consent)
- Builds structured **context**
- Routes requests through an **AI orchestration** layer
- Talks to one or more **AI providers** via a stable abstraction
- Persists configuration and history under **enterprise security, logging, and retention** controls

It is **not** a stealth / interview-cheat / exam-answer product. Window behavior, prompts, and logging assume corporate transparency and auditability.

---

## 2. Design principles

1. **Process isolation first** — `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer where feasible; all privileged work in main.
2. **Thin preload** — `contextBridge` exposes a small, typed API; no Node modules leak to the UI.
3. **Domain logic outside UI** — session, context, AI, prompts, storage, and configuration live in `core/`, not in React components.
4. **Provider-agnostic AI** — orchestration never imports a vendor SDK directly; adapters implement a common interface.
5. **Capture is a capability, not a product feature dump** — screen/audio pipelines are isolated modules with clear main vs renderer ownership.
6. **Secure by default** — credentials never in plaintext on disk; never returned raw to the renderer; logs redacted.
7. **Testable seams** — interfaces at IPC, providers, storage, and capture boundaries.
8. **Independent codebase** — no imports, paths, branding, or runtime coupling to the reference repository.

---

## 3. Process model

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer (React + TypeScript)                               │
│  UI · local capture encoding · state · calls window.api     │
└──────────────────────────┬──────────────────────────────────┘
                           │ contextBridge (preload)
┌──────────────────────────▼──────────────────────────────────┐
│ Preload                                                     │
│  Typed invoke/on wrappers only — no business logic          │
└──────────────────────────┬──────────────────────────────────┘
                           │ ipcMain / webContents
┌──────────────────────────▼──────────────────────────────────┐
│ Main (Electron)                                             │
│  Windows · IPC adapters · native helpers · wires core/*     │
│                                                             │
│  core/  → session · context · ai · prompts · storage · cfg  │
│  capture/ (native / policy side) · logging · credentials    │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
        AI providers / gateway         OS APIs / child procs
```

| Process | Allowed | Forbidden |
|---------|---------|-----------|
| **Renderer** | UI, MediaStream/AudioWorklet, canvas screenshots, calling preload API | `require`, Node FS, spawning processes, holding API keys |
| **Preload** | `contextBridge.exposeInMainWorld`, `ipcRenderer.invoke/on` | Domain logic, storage, AI SDKs |
| **Main** | Windows, IPC validation, credentials, orchestration, native audio helper, provider I/O | Trusting unvalidated renderer payloads |

---

## 4. Repository structure

Starting from the requested layout, with small adjustments for enterprise concerns (logging, credentials, native resources, tests, shared IPC contracts).

```
AP AI assistance tool/
├── REFERENCE_ANALYSIS.md
├── ARCHITECTURE.md                 # this document
├── package.json                    # (future)
├── forge.config.ts                 # (future) Electron Forge + fuses
├── tsconfig.base.json
├── tsconfig.main.json
├── tsconfig.preload.json
├── tsconfig.renderer.json
├── resources/
│   └── native/                     # platform helpers (e.g. macOS system audio)
│       ├── darwin/
│       ├── win32/                  # reserved if needed
│       └── checksums.json          # integrity manifests
├── tests/
│   ├── unit/
│   ├── contract/                   # IPC + provider contract tests
│   └── e2e/                        # later
└── src/
    ├── main/
    │   ├── index.ts                # app lifecycle bootstrap
    │   ├── ipc/                    # channel registration + validation
    │   ├── windows/                # BrowserWindow factories & policies
    │   └── services/               # Electron adapters that call core/
    │
    ├── preload/
    │   └── index.ts                # contextBridge surface
    │
    ├── renderer/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── components/
    │   ├── pages/
    │   ├── hooks/
    │   ├── services/               # thin clients over window.api + local capture
    │   └── state/                  # UI state only
    │
    ├── core/                       # process-agnostic domain (invoked from main)
    │   ├── ai/
    │   ├── audio/                  # AudioCaptureController + AudioFormatAdapter
    │   ├── transcription/          # TranscriptStore
    │   ├── stt/                    # STTProvider interface + MockSTTProvider
    │   ├── questions/              # detection, classification, QuestionManager
    │   ├── context/                # ContextEngine + builders/providers
    │   ├── session/
    │   ├── prompts/
    │   ├── storage/
    │   └── configuration/
    │
    ├── capture/
    │   ├── screen/
    │   └── audio/
    │
    └── shared/
        ├── types/
        ├── constants/
        └── ipc/                    # shared channel names + payload schemas
```

### Adjustments vs the starting sketch

| Change | Why |
|--------|-----|
| `shared/ipc/` added | Single source of truth for channel names and DTO shapes across main/preload/renderer |
| `main/services/` kept as adapters | Keeps Electron APIs out of `core/` so domain logic stays testable without Electron |
| `resources/native/` added | Packaging home for platform audio helpers and checksums |
| `tests/` at repo root | Enterprise CI expects first-class test layout |
| Credentials under `core/configuration` + main credential service | Secrets policy lives with config; OS keychain access stays in main |
| Enterprise logger as `main/services/logging` + `shared/types` for log events | Logging must touch files/network only from main |

`core/` modules **must not** import `electron`, React, or renderer code. They receive ports/interfaces injected by `main/services`.

---

## 5. Layer responsibilities

### 5.1 Electron main (`src/main`)

| Area | Responsibility |
|------|----------------|
| `index.ts` | `app.whenReady`, single-instance lock, quit cleanup, wire services |
| `windows/` | Create/destroy windows; secure `webPreferences`; display-media policy; shortcuts; no stealth defaults |
| `ipc/` | Register handlers; validate payloads (shared schemas); map errors to safe client messages |
| `services/` | Adapters: SessionHost, CaptureHost, CredentialVault, ConfigHost, Logger, ProviderRuntime |

Main owns **all** network calls to AI providers, credential reads, and native child processes.

### 5.2 Preload (`src/preload`)

Exposes a minimal nested API via `window.companyAI`:

- `app.getVersion` / `app.getInfo`
- `system.getStatus` (IPC health)
- `session.start` / `session.stop` / `session.getStatus` / `session.onStatusChanged`
- `config.getPublic` / `config.update` (no secrets)
- `credentials.has` / `credentials.set` / `credentials.delete` (returns `{ configured }` only)
- `foundation.getDiagnostics`
- `audio.*` (devices, permission, start/pause/resume/stop, status, chunk ingest)
- `transcript.*` (recent/snapshot/clear/status + partial/final/error events)
- `stt.getStatus` / `stt.onStatusChanged`

See `docs/audio-architecture.md`, `docs/stt-architecture.md`, `docs/question-understanding.md`, and `docs/context-engine.md`.

No business rules in preload—only marshalling. `ipcRenderer` is never exposed.

### 5.3 Renderer (`src/renderer`)

| Area | Responsibility |
|------|----------------|
| `pages/` / `components/` | Enterprise UI (assistant, settings, history, permissions) |
| `state/` | View models, streaming response buffers, capture UI indicators |
| `hooks/` | React hooks wrapping renderer services |
| `services/` | `window.api` clients; **local** screen/mic MediaStream + AudioWorklet encode; screenshot JPEG |

Renderer capture produces **frames/chunks** and sends them through preload IPC. It does not choose models, assemble system prompts, or talk to vendors.

### 5.4 Application / session (`src/core/session`)

Owns the assistant **session lifecycle**:

- Create session ID + correlation ID
- Track state: `idle → starting → active → pausing → stopping → error`
- Coordinate permissions (screen/audio granted?)
- Bind capture streams to context + orchestrator
- Enforce retention / wipe on session end when policy requires
- Emit domain events for UI (status, transcript partials, assistant deltas)

### 5.5 Context acquisition (`src/core/context` + `src/capture`)

**Capture** acquires raw signals. **Context engine** turns them into structured packets for AI.

Context packet (conceptual contents):

- Role / assistant mode (company-approved)
- User-provided notes / selected documents (allowlisted)
- Recent transcript window (size-capped)
- Optional screenshot summary or image reference
- Tool policy flags (search allowed?, internal KB allowed?)
- Privacy marks (retention class, redaction level)

Context engine responsibilities:

- Windowing / summarization of transcripts
- Deduplication and rate-limiting of screen frames into the model
- Merging configuration + prompt role + live signals
- Never storing more than policy allows

### 5.6 AI orchestration (`src/core/ai`)

| Module | Role |
|--------|------|
| `orchestrator` | Accepts intents (`ask`, `onTranscript`, `onScreenshot`, `cancel`); builds provider requests using prompts + context; streams results back as domain events |
| `routing` | Chooses provider/model per task (transcribe vs answer vs vision) from configuration allowlists |
| `providers/` | Interface + adapters (company gateway, cloud vendor SDKs, optional local runtime) |

Orchestrator rules:

- One active primary conversation stream per session (reconnect policy is explicit)
- Cancellation is first-class
- Failures map to typed errors (`Auth`, `RateLimit`, `Network`, `PolicyDenied`, `Provider`)
- No prompt strings hard-coded in provider adapters

### 5.7 AI providers (`src/core/ai/providers`)

Common port (conceptual):

- `connect(sessionConfig)`
- `sendAudio(chunk)`
- `sendImage(frame)`
- `sendText(message)`
- `subscribe(events)`
- `close()`

Adapters implement transport details (HTTP, WebSocket, SDK live sessions). Local/offline adapters may wrap STT+LLM runners, but still sit behind the same port.

### 5.8 Prompts (`src/core/prompts`)

- Versioned templates for company roles (meeting assist, knowledge Q&A, writing help, etc.)
- Builder merges: template + user context + policy clauses + tool instructions
- Change control: prompt versions recorded in session metadata for audit
- No exam/cheat/teleprompter profiles

### 5.9 Storage (`src/core/storage`)

| Store | Contents | Notes |
|-------|----------|-------|
| Preferences | Non-secret settings | Schema-validated |
| Session history | Turns, optional summaries | TTL + user delete |
| Attachments metadata | References only | Binary blobs policy TBD |
| Audit/diagnostic logs | Redacted events | Separate from history |

Storage interfaces are implemented by main services (filesystem / future DB). `core` depends on abstract repositories.

### 5.10 Configuration (`src/core/configuration`)

- Feature flags, model allowlists, capture defaults, retention days, gateway base URL
- Schema version + migrations
- Distinguishes **public config** (safe for renderer) vs **secret config** (main-only)
- Credential handles referenced by ID, not raw keys in config files

### 5.11 Capture (`src/capture`) + capture policy (`src/core/capture-policy`)

```
capture/
├── screen/          # frame grab contracts (acquisition deferred)
└── audio/           # PCM types / helpers

core/capture-policy/ # STANDARD | PRIVACY_AWARE | DISABLED
main/capture/        # ElectronCaptureCapabilityProvider + CapturePolicyHost
```

**Window privacy (Phase 2F):** `BrowserWindow.setContentProtection` applied via `CapturePolicyHost` after window creation. Capabilities and overall status are reported as `SUPPORTED` / `PARTIAL` / `UNSUPPORTED` / etc. Configuring the API is not a claim that every third-party recorder will honor it.

**Visual context (Phase 2G):** Explicit `desktopCapturer` / manual image capture via `VisualContextHost`. Frames are validated, deduplicated, bounded, and attached as `ContextSnapshot.visualContext` (metadata + refs).

**Visual intelligence (Phase 2H):** `VisualIntelligencePipeline` runs provider-independent OCR + vision analysis on captured frames (mocks for tests; OpenAI adapters in main using `ai.openai.apiKey`). Results enrich `VisualContextSnapshot` (`ocrResults`, `visionAnalyses`) for the existing Context Engine and text PromptBuilder. Text-only `AIProvider.generate` is unchanged — no multimodal answer stream in this phase. See `docs/visual-intelligence.md`.

**Product UX (Phase 2I + 2J + 2K):** Prepare → Live Interview → Summary via `InterviewHost`. Documents extract to bounded session context; `DocumentRelevanceSelector` picks question-relevant excerpts into `ContextSnapshot.interviewDocuments`. Start Interview enables auto-generate + auto listening. Phase 2K hardens pause/end/new isolation, resource cleanup, and MockAI lifecycle tests. Engineering panels under Settings → Advanced Diagnostics. See `docs/product-ux.md`, `docs/document-intelligence.md`, and `docs/mvp-stabilization.md`.

**Ownership split:**

| Capability | Where it runs | Why |
|------------|---------------|-----|
| `getDisplayMedia` / `getUserMedia` | Renderer | Browser media APIs |
| AudioWorklet PCM encode | Renderer | Real-time, non-blocking UI thread |
| Canvas → JPEG screenshot | Renderer | Needs video element / frame |
| Display-media permission policy | Main (`windows/`) | Electron session handler |
| macOS system-audio helper process | Main service + `resources/native` | Child process + packaging |
| Windows loopback | Renderer via display-media audio (+ main policy) | Platform loopback path |
| VAD / resample pure functions | `capture/audio` (shared logic usable from main or workers) | Unit-testable |

---

## 6. Data & control flows

### 6.1 Session start

```
UI "Start"
  → preload session.start(publicOptions)
  → main IPC validate
  → SessionService starts core.session
  → credentials resolved in main
  → orchestrator.connect(provider)
  → capture arming (renderer media + optional main helper)
  → UI shows capturing indicator + session status
```

### 6.2 Audio → answer

```
Renderer AudioWorklet PCM chunk
  → ipc sendAudio (binary/base64 per contract)
  → Session routes to ContextEngine (transcript path) and/or Orchestrator
  → Provider adapter streams transcription / completion
  → domain events → IPC → renderer state → UI
```

### 6.3 Screenshot → vision assist

```
User shortcut / button
  → renderer captures JPEG (size-capped)
  → ipc sendImage
  → ContextEngine attaches frame + prompt role
  → Orchestrator routes to vision-capable provider
  → streamed response to UI
```

### 6.4 Configuration change

```
Settings UI updates public preferences
  → validated IPC
  → configuration repository
  → hot-reload safe fields; restart-required fields flagged
Secret changes (API key / SSO token)
  → CredentialVault only; renderer learns "configured: true"
```

---

## 7. IPC architecture

### 7.1 Contract location

`src/shared/ipc/` defines:

- Channel name constants
- Request/response types
- Event channel types for streams
- Validation schemas (shared definitions; runtime validate in main)

### 7.2 Rules

1. Every `invoke` handler validates input before calling core.
2. Renderer never receives raw secrets.
3. `openExternal` is allowlisted by host/protocol.
4. Streamed AI tokens use `webContents.send` on dedicated event channels with session ID.
5. Errors returned to UI are safe (no stack traces with paths/keys in production).

### 7.3 Implemented channel groups (foundation + Phase 2A)

- `app:*`
- `system:*`
- `session:*`
- `config:*`
- `credentials:*`
- `foundation:*`
- `audio:*`
- `transcript:*`
- `stt:*`
- `question:*`
- `context:*`

Screen capture / AI / history channels remain reserved for later phases.

### 7.4 Security defaults (implemented)

```ts
webPreferences: {
  preload,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true, // compatible with current preload; document any future exception before disabling
  webSecurity: true,
}
```

---

## 8. Security architecture

| Control | Requirement |
|---------|-------------|
| Web preferences | `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`; prefer `sandbox: true` |
| Preload surface | Minimal; reviewed when changed |
| Credentials | Electron `safeStorage` ciphertext under `userData/credentials/` (no plaintext fallback); main-only |
| CSP | Dev: Vite-compatible policy with style `'unsafe-inline'`; Prod: stricter header via `session.webRequest` (no unsafe-inline) |
| Logging | Structured JSON to console + rotating `userData/logs/app.log`; redaction filters; correlation/session IDs |
| Capture UX | Visible “capturing” state; explicit permission flows |
| Packaging | ASAR + Electron fuses; signed builds; native helper checksums |
| Updates | Company feed only (when enabled); no public GitHub update checks |
| Retention | Configurable TTL; user wipe; admin policy hooks later |

Stealth behaviors from the reference analysis (hide from taskbar/Mission Control, content protection as anti-detection, emergency erase UX) are **out of scope** unless InfoSec explicitly requests a documented variant.

---

## 9. Enterprise logging

Logging is a cross-cutting main service used by IPC, session, providers, and capture hosts.

| Level | Use |
|-------|-----|
| `debug` | Dev-only; may include non-PII technical detail |
| `info` | Session lifecycle, provider connect/disconnect |
| `warn` | Retries, degraded capture, policy denials |
| `error` | Failures with safe error codes |

**Never log:** API keys, tokens, raw audio, full screenshots, full prompt bodies containing secrets, unrestricted transcript archives (unless explicitly enabled under a compliance mode with retention).

Optional sinks: local rotating files, future OpenTelemetry / company SIEM export.

---

## 10. Testing strategy (architectural)

| Layer | Test type |
|-------|-----------|
| `core/*` | Unit tests with mocked ports (no Electron) — **Vitest** |
| `capture/audio` pure functions | Unit (resample, mono mix, VAD thresholds) |
| `shared/ipc` schemas | Contract / validation tests — **Vitest + Zod** |
| `main/ipc` handlers | Integration with mocked BrowserWindow (later) |
| Providers | Adapter tests against recorded fixtures / mock servers (later) |
| Renderer | Component tests for critical flows (later) |
| E2E | Smoke: launch → start session (mocked provider) → stop (later) |

**Foundation choice:** Vitest (TypeScript-native, Vite-aligned, fast Node unit tests). Zod validates IPC and configuration payloads.

---

## 11. Packaging & runtime topology

- **Packager:** Electron Forge (aligned with reference *concepts*, new config)
- **Bundling:** TypeScript build for main/preload; Vite or Forge webpack/vite plugin for renderer (decision deferred to scaffold phase)
- **Artifacts:** platform installers; `resources/native` copied as `extraResource`
- **Platform support:** Windows primary; macOS supported; Linux best-effort

---

## 12. Module dependency rules

Allowed dependency direction:

```
renderer → shared
preload  → shared
main     → shared, core, capture
core     → shared          (and interfaces only)
capture  → shared
services (main) → core, capture, electron
```

Forbidden:

```
core → electron | renderer | preload
renderer → core | main | electron
capture platform native spawn → renderer
provider SDKs → renderer
```

---

## 13. Mapping: enterprise concerns → folders

| Concern | Primary location |
|---------|------------------|
| Electron main process | `src/main/` |
| Preload / contextBridge | `src/preload/` |
| Renderer UI | `src/renderer/` |
| Application / session logic | `src/core/session/` |
| AI orchestration | `src/core/ai/` (orchestrator, routing) |
| AI providers | `src/core/ai/providers/` |
| Context acquisition | `src/core/context/` + `src/capture/` |
| Storage | `src/core/storage/` (+ main storage adapters) |
| Configuration | `src/core/configuration/` |
| Capture | `src/capture/` + renderer capture services + main native helper service |
| Shared contracts | `src/shared/` |

---

## 14. Non-goals (architecture phase)

- Implementing features or scaffolding package.json
- Installing dependencies
- Copying or wrapping the reference repository
- Final UI visual design system selection
- Additional AI vendor SDKs beyond OpenAI (Anthropic/Gemini adapters deferred; OpenAI selected in Phase 2E)

---

## 15. Next phase (not executed now)

When implementation is approved:

1. Scaffold Electron + React + TypeScript with the folder tree above  
2. Secure window + preload hello-world + IPC contract stubs  
3. Configuration + logging + credential vault stubs  
4. Capture vertical slice (screen screenshot round-trip)  
5. Provider stub + orchestrator text round-trip  
6. Harden and expand per `REFERENCE_ANALYSIS.md` phases  

---

*This document defines the target architecture for the independent AP AI Assistance Tool. It intentionally contains no application implementation.*
