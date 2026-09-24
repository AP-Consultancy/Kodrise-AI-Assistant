# Reference Analysis — AP AI assistance tool

> **Status:** Analysis only. No application code implemented. No dependencies installed.  
> **Reference inspected (read-only):** `D:\ai cheating tool\cheating-daddy` (v0.8.0, GPL-3.0)  
> **New project root (write target):** `D:\AP AI assistance tool`  
> **Intent:** Study reusable *technical concepts* from the reference; design a **new** internal company AI assistant. This is **not** a rename/fork of the reference product.

---

## 1. Useful modules from the reference project

These modules demonstrate patterns worth understanding. Treat them as study material, not as drop-in packages for the new app.

| Reference module | What it does well | Why it matters for the new app |
|------------------|-------------------|--------------------------------|
| `src/index.js` | Electron app lifecycle, storage init, macOS screen-permission nudge, IPC registration, quit cleanup | Clear main-process bootstrap shape (to be rewritten in TypeScript with secure defaults) |
| `src/utils/window.js` | `BrowserWindow` creation, `setDisplayMediaRequestHandler`, global shortcuts, click-through, multi-monitor move | Useful for overlay UX and capture permission wiring — **not** stealth/taskbar-hiding for enterprise |
| `src/utils/renderer.js` (capture portions) | Cross-platform screen + audio capture orchestration (`getDisplayMedia` / `getUserMedia`), PCM Int16 encoding, canvas→JPEG screenshots | Core capture concepts: dual streams, sample rate, manual screenshot mode |
| `src/utils/gemini.js` (macOS audio + session pieces) | Spawn/kill `SystemAudioDump`, stereo→mono, chunked PCM → provider; Gemini Live connect/reconnect; Groq/Gemma fallbacks | Platform audio helper lifecycle; live multimodal session patterns |
| `src/audioUtils.js` | PCM→WAV, buffer RMS/silence analysis, optional debug dumps | Debugging and audio QA utilities (reimplement with company paths + redaction) |
| `src/utils/localai.js` | VAD, 24 kHz→16 kHz resample, Whisper HTTP STT, llama-server chat/vision | Offline / on-device pipeline concepts for enterprise air-gapped options |
| `src/utils/native-ai-runtime.js` | SHA-256 verified downloads, spawn localhost servers, port wait, process logging | Secure-ish native binary lifecycle (point at **company-controlled** artifacts) |
| `src/utils/prompts.js` | Profile-based system prompt assembly (`intro` + format + tools + content) | Prompt composition pattern — replace profiles with company-approved roles |
| `src/storage.js` | Versioned config dir, preferences/history/limits split across JSON files | Persistence layering idea; reimplement with encryption + schema validation |
| `src/utils/transportLogger.js` | Per-session streaming JSON event log | Logging *shape* only; must not persist secrets/PII by default |
| `src/utils/cloud.js` | WebSocket session with audio/text/image frames + streamed responses | Pattern for a **company AI gateway** client (not the third-party cloud product) |
| `forge.config.js` | ASAR packaging, `extraResource` for native helper, makers (Squirrel/DMG/AppImage), Electron fuses | Packaging baseline for Electron Forge |
| `entitlements.plist` | macOS codesign entitlement keys (audio, network, JIT) | Starting checklist for signed macOS builds (narrow for enterprise) |

### Dependency concepts worth noting (from `package.json`)

- **Runtime ideas:** Electron + Forge packaging; optional Google GenAI Live SDK; WebSocket client for gateway mode.
- **Dev/packaging ideas:** `@electron-forge/*` makers, `@electron/fuses`, auto-unpack-natives.

---

## 2. Modules / product surface we should NOT carry forward

Do **not** port these as product behavior, branding, or default UX.

| Do not carry forward | Reason |
|----------------------|--------|
| Product identity (`cheating-daddy`, “Cheating Daddy”, domains, logos, update checks to upstream GitHub) | New internal product; avoid confusion and GPL derivative branding issues |
| Interview teleprompter / exam-answer profiles and copy in `prompts.js` + `MANUAL_SCREENSHOT_PROMPT` | Conflicts with typical corporate acceptable-use and compliance |
| Stealth window features: `setContentProtection`, skip taskbar, hide from Mission Control, “emergency erase” as anti-detection UX | Enterprise assistants need transparency and auditability |
| Lit web-component UI (`CheatingDaddyApp`, views, vendored Lit/marked/highlight assets) | New stack is **React + TypeScript** |
| Empty / unused `preload.js` + `nodeIntegration: true` / `contextIsolation: false` | Explicitly forbidden for the new app |
| Plaintext `credentials.json` with renderer-readable API keys | Insecure for enterprise |
| Upstream `api.cheatingdaddy.com` cloud mode and token-in-URL auth | Wrong vendor; insecure auth pattern |
| Free-tier rate-limit gymnastics tied to Gemini/Groq consumer quotas | Company should use contracted providers / gateway quotas |
| Bundled frontend minified libs without npm provenance | Prefer declared npm deps + SBOM |
| Dead references (`script.js`, missing `AdvancedView`) and dual settings (filesystem + localStorage via `executeJavaScript`) | Technical debt |
| GPL-3.0 copyleft as the new project’s license (without legal clearance) | New internal app needs its own licensing decision; **do not strip upstream LICENSE in the reference repo** |

---

## 3. Concepts worth reimplementing

Rebuild these as **first-class, typed modules** in the new architecture — cleaner boundaries than the reference.

### Electron & packaging

1. **Main / preload / renderer process model** with `contextIsolation: true`, `nodeIntegration: false`, and a minimal `contextBridge` API.
2. **Electron Forge** packaging with ASAR, fuses (`RunAsNode` off, cookie encryption, ASAR integrity), and platform makers.
3. **Global shortcuts** for productivity (move/focus/capture) — without stealth semantics.
4. **Display-media handler** in main for screen + loopback audio, with explicit user consent UX.

### Capture

5. **Screen capture** via `getDisplayMedia` + canvas JPEG (manual and/or policy-gated interval).
6. **Dual audio modes:** system/loopback, microphone, or both.
7. **Platform-specific system audio:**
   - **Windows:** display-media loopback.
   - **macOS:** native helper binary (conceptually like `SystemAudioDump`) packaged as `extraResource`, managed from main.
   - **Linux:** best-effort display-media audio + mic fallback.
8. **PCM pipeline:** Float32 → Int16, fixed sample rate (e.g. 24 kHz for live providers; 16 kHz for Whisper), chunking, stereo→mono.

### Native process handling

9. **Child-process lifecycle:** spawn, stdout chunking, graceful kill, single-instance guards.
10. **Verified artifact install:** checksum before run; company CDN/artifact store instead of public GitHub releases.
11. **Local STT/LLM servers** (optional enterprise mode): localhost-only bind, health waits, cancelable init.

### AI integration concepts

12. **Session-oriented orchestration:** start/stop session, reconnect, stream partial responses to UI.
13. **Multimodal inputs:** audio frames, text turns, screenshot images.
14. **Provider fallback / routing** (transcription provider vs answer provider) — as an *abstraction*, not hard-coded Gemini+Groq.
15. **Centralized prompt management:** role templates + user/company context injection + tool flags.
16. **Optional offline path:** VAD → STT → LLM for sensitive environments.

### Application quality

17. **Versioned local config** with migration/reset policy.
18. **Session history** with retention TTL and user wipe.
19. **Structured logging** with levels, redaction, and correlation IDs (enterprise-ready — not full payload dumps).

---

## 4. Potential code that could be adapted

> **Legal note:** The reference is **GPL-3.0**. Adapting substantial code into a proprietary internal product may trigger copyleft obligations. Prefer **reimplementation from concepts** unless legal counsel approves GPL-compatible distribution. The list below flags *technical* candidates only.

| Candidate (conceptual adaptation) | Source | Adaptation notes |
|-----------------------------------|--------|------------------|
| PCM→WAV + audio buffer analysis | `audioUtils.js` | Small, self-contained; easy clean-room rewrite |
| Stereo→mono + chunk sizing for macOS helper stdout | `gemini.js` (`convertStereoToMono`, capture loop) | Reimplement in a dedicated `AudioCaptureService` |
| Platform capture branching | `renderer.js` `startCapture` | Move logic behind a Capture module; use AudioWorklet instead of `ScriptProcessorNode` |
| Display media request handler | `window.js` | Keep loopback idea; require source picker / policy, not silent `sources[0]` |
| Prompt assembly structure | `prompts.js` `buildSystemPrompt` / `getSystemPrompt` | Keep structure; replace all profile text |
| Checksummed download + spawn | `native-ai-runtime.js` | Strong pattern; retarget URLs and signing |
| VAD + resample + Whisper/Llama HTTP | `localai.js` | Valuable offline design; isolate from UI |
| Session transport event envelope | `transportLogger.js` | Keep event `{timestamp, type, data}` shape; add redaction + levels |
| Forge fuses + `extraResource` | `forge.config.js` | Reuse approach with new product name/icons |
| Storage file split (config / prefs / history) | `storage.js` | Reuse *schema separation*; add encryption & Zod/io-ts validation |

**Do not adapt wholesale:** `CheatingDaddyApp.js`, Lit views, `cloud.js` vendor protocol, plaintext credential IPC surface, stealth window flags, exam/interview prompts.

---

## 5. Dependencies worth considering

Not installing yet. Candidates for the **new** stack:

### Core platform

| Dependency | Role |
|------------|------|
| `electron` (current stable LTS line) | Desktop runtime |
| `@electron-forge/cli` + makers (`squirrel`, `dmg`, `zip` / AppImage as needed) | Dev/start/package/make |
| `@electron-forge/plugin-fuses` / `@electron/fuses` | Harden packaged binary |
| `@electron-forge/plugin-webpack` or `vite-plugin-electron` / `electron-vite` | Modern TS+React bundling (choose one toolchain and stick to it) |
| `electron-squirrel-startup` | Windows installer early-exit (if using Squirrel) |

### UI

| Dependency | Role |
|------------|------|
| `react`, `react-dom` | UI |
| TypeScript | Strict typing across main/preload/renderer |
| UI kit (e.g. company design system or carefully chosen component library) | Consistent enterprise UI — avoid shipping the reference’s Lit stack |

### Security & config

| Dependency | Role |
|------------|------|
| `zod` (or similar) | IPC payload + config schema validation |
| `keytar` / `safeStorage` (Electron) / OS credential APIs | Secure credential storage |
| `electron-store` (optional) or custom encrypted store | Preferences only — secrets stay in OS secure storage |

### AI provider abstraction (examples — final set is a product decision)

| Dependency / approach | Role |
|-----------------------|------|
| Official SDKs behind adapters (`@google/genai`, OpenAI SDK, Anthropic SDK, Azure OpenAI, etc.) | Provider implementations |
| `ws` or undici WebSocket | Company gateway transport |
| No hard dependency on a single vendor in the orchestration core | Keep providers swappable |

### Local / native (optional)

| Dependency / artifact | Role |
|-----------------------|------|
| Company-built or licensed STT/LLM runners | Offline mode |
| Native audio helper for macOS (licensed separately) | System audio |

### Testing & quality

| Dependency | Role |
|------------|------|
| `vitest` or `jest` | Unit tests (main services, prompts, providers) |
| `@testing-library/react` | UI tests |
| Playwright / Spectron alternative for Electron E2E (e.g. Playwright electron) | Smoke packaging flows |
| `eslint`, `@typescript-eslint/*`, `prettier` | Lint/format (reference had Prettier only; lint was a no-op) |
| Structured logger (`pino` / `winston`) with redaction | Enterprise logging |

### Observability (enterprise)

| Approach | Role |
|----------|------|
| Correlation IDs per session | Support/debug |
| Optional export to company SIEM / OpenTelemetry | Compliance — never log raw secrets or full meeting audio by default |

---

## 6. Security improvements required

Compared to the reference, the new app **must** ship with these as non-negotiable defaults:

| Area | Reference weakness | Required improvement |
|------|--------------------|----------------------|
| Process isolation | `nodeIntegration: true`, `contextIsolation: false`, empty preload | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where feasible, **preload + contextBridge only** |
| IPC | Wide, unvalidated handlers; credentials returned to renderer | Typed IPC contracts; allowlisted channels; validate with schemas; never expose raw secrets to renderer (use session tokens / “configured?” flags) |
| Credentials | Plaintext JSON on disk | OS keychain / Electron `safeStorage`; memory-only use in main; wipe on logout |
| External open | Unbounded `shell.openExternal` | Host/protocol allowlist |
| Logging | Full transcriptions/responses/tokens in transport logs | Structured logs; redaction; opt-in debug; retention limits; no tokens in URLs or log lines |
| Capture consent | Auto-picks first screen + loopback | Explicit picker / policy; clear in-app indicator when capturing |
| CSP | `'unsafe-inline'` scripts | Strict CSP; no inline scripts; hashed or nonced assets only |
| Child processes | Packaged helper + downloaded binaries | Code signing, checksum + signature verification, company artifact source |
| Gateway auth | Token in WebSocket query string | Header / subprotocol / mutual TLS via company gateway |
| Window policy | Stealth / content protection / hide from OS switchers | Transparent enterprise window behavior; optional content protection only if InfoSec approves |
| Supply chain | Pulls upstream releases & models | Pin versions; SBOM; internal mirrors; disable public update checks |
| Data governance | Indefinite history + full logs | Retention TTL, DLP-aware defaults, export/delete controls |
| Main→renderer `executeJavaScript` | Used for settings/shortcuts bridging | Replace with explicit IPC events |

---

## 7. Recommended new project architecture

Greenfield layout under `D:\AP AI assistance tool` (illustrative):

```
AP AI assistance tool/
├── REFERENCE_ANALYSIS.md          # this document
├── package.json
├── forge.config.ts                # or electron-vite / forge+webpack config
├── tsconfig.json                  # project references: main / preload / renderer
├── src/
│   ├── main/
│   │   ├── index.ts               # app lifecycle
│   │   ├── window.ts              # BrowserWindow (secure prefs)
│   │   ├── ipc/                   # register*Handlers + validation
│   │   ├── session/               # ApplicationSession / SessionManager
│   │   ├── capture/               # macOS helper control, display-media policy
│   │   ├── native/                # process spawn, artifact verify
│   │   ├── config/                # secure config + preferences
│   │   ├── credentials/           # keychain / safeStorage
│   │   └── logging/               # enterprise logger
│   ├── preload/
│   │   └── index.ts               # contextBridge API surface only
│   ├── renderer/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── features/              # session UI, settings, history
│   │   └── capture/               # MediaStream, AudioWorklet, screenshots
│   ├── shared/
│   │   ├── ipc-contract.ts        # shared types for invoke/on channels
│   │   ├── prompts/               # centralized prompt templates + builders
│   │   └── models/                # DTOs, enums
│   ├── application/               # session layer orchestration (may live in main)
│   ├── context/                   # Context Engine (screen/audio/user/company knowledge)
│   ├── ai/
│   │   ├── orchestrator.ts        # AI orchestration layer
│   │   ├── providers/             # Provider abstraction + adapters
│   │   └── routing.ts             # model/tool routing policies
│   └── test/                      # unit + contract tests
└── resources/
    └── native/                    # platform helpers (company-licensed)
```

### Layer responsibilities

| Layer | Responsibility |
|-------|----------------|
| **Renderer (React)** | UX only; capture encoding; calls preload API; never Node APIs |
| **Preload** | Thin, audited bridge: `window.companyAI.*` |
| **Application / Session** | Start/stop sessions, permissions state, retention, user actions |
| **Context Engine** | Builds structured context packets (recent transcript snippets, selected screenshot, user/company docs, role policy) for the orchestrator |
| **AI Orchestration** | Turns context + user intent into provider calls; streams results; handles cancel/reconnect |
| **AI Provider Abstraction** | `Provider` interface: `connect`, `sendAudio`, `sendImage`, `sendText`, `close`; implementations for gateway / cloud vendors / local |
| **Prompt Management** | Versioned templates; no free-form secrets in prompts; company policy gates |
| **Secure Configuration** | Schema-validated prefs; feature flags; model allowlists |
| **Credentials** | Main-process only; encrypted at rest |
| **Logging** | Levels, redaction, correlation IDs; optional remote sink |

### Security defaults (must match product requirements)

```ts
webPreferences: {
  preload: pathToPreload,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true, // prefer on unless a hard blocker is proven
  webSecurity: true,
}
```

---

## 8. Migration / reimplementation strategy

This is a **reimplementation**, not a file-copy migration.

### Phase 0 — Governance (before coding features)

1. Legal review: GPL-3.0 implications of any line-level reuse; choose new project license.
2. Product policy: allowed use cases (meeting assist, knowledge Q&A, etc.); forbid exam/cheat teleprompter UX.
3. Decide AI topology: **company gateway (preferred)** vs BYOK vs local-only.
4. Confirm macOS system-audio helper licensing and packaging approach.

### Phase 1 — Skeleton (no AI yet)

1. Scaffold Electron + React + TypeScript with Forge (or chosen bundler).
2. Secure window + preload IPC hello-world.
3. Config + logger + credential stubs.
4. CI: typecheck, lint, unit test smoke.

### Phase 2 — Capture foundation

1. Screen capture + manual screenshot path.
2. Windows loopback + mic modes.
3. macOS helper integration behind a `SystemAudioCapture` interface.
4. AudioWorklet PCM pipeline; unit-test encode/resample helpers.

### Phase 3 — AI stack

1. Provider interface + one gateway or one cloud adapter.
2. Orchestrator + Context Engine (text-only first, then audio, then vision).
3. Centralized prompts for company roles.
4. Session history with retention.

### Phase 4 — Hardening

1. IPC fuzz/contract tests; CSP lock-down.
2. Credential encryption; redacted logging.
3. Packaging, code signing, fuses, SBOM.
4. Optional local STT/LLM path with verified binaries.

### Phase 5 — Enterprise rollout

1. Internal update feed; telemetry/privacy docs.
2. Admin policies (model allowlist, capture required banner, retention).
3. Pilot → GA.

### Explicit non-strategy

- Do **not** clone the reference repo into this folder and rename strings.
- Do **not** modify files under `D:\ai cheating tool\cheating-daddy` (reference only).
- Do **not** delete or alter the reference `LICENSE` or attribution.
- Develop the new application **only** in `D:\AP AI assistance tool`.
- Do **not** install dependencies until the next implementation phase is approved.

---

## Appendix A — Reference inventory (for navigation)

| Concern | Reference locations |
|---------|---------------------|
| Electron main | `src/index.js`, `src/utils/window.js` |
| Preload | `src/preload.js` (stub — anti-pattern) |
| Screen/audio capture | `src/utils/renderer.js`, `window.js` display-media handler |
| macOS system audio | `gemini.js` (`SystemAudioDump`), `forge.config.js` `extraResource` |
| AI live / HTTP | `src/utils/gemini.js` |
| Cloud WS | `src/utils/cloud.js` |
| Local AI | `src/utils/localai.js`, `src/utils/native-ai-runtime.js` |
| Prompts | `src/utils/prompts.js` |
| Storage | `src/storage.js` |
| Packaging | `forge.config.js`, `package.json` |

## Appendix B — Working assumptions

- New app targets internal company users (Windows primary, macOS supported, Linux secondary).
- Secure Electron defaults and layered architecture are mandatory from day one.
- Reference remains a **read-only technical study resource**.

---

*Generated from static inspection of the reference repository. No reference files were modified. No dependencies were installed.*
