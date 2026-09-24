# Audio Architecture — Phase 2A

> Project: AP AI Assistance Tool  
> Scope: Real-time audio input → transcription foundation only  
> Real STT providers, AI answers, screen capture, OCR, and RAG are out of scope.

---

## Pipeline

```
Renderer (getUserMedia + PCM encode)
    ↓ audio chunks (base64 DTO via preload)
AudioHost (main)
    ↓
AudioCaptureController (core lifecycle)
    ↓
STTProvider (MockSTTProvider in Phase 2A)
    ↓ partial / final events
TranscriptStore (bounded history)
    ↓ typed IPC events
Renderer Live Transcript UI
```

Microphone hardware APIs stay in the renderer. Domain lifecycle, transcript state, and STT abstraction live in `core/` and are orchestrated from main.

---

## Permission model

- Permission is **never** requested on app launch.
- The UI shows: Required / Granted / Denied / Unavailable / Unknown.
- User must click **Request permission** (or grant via OS prompt during an explicit start path after permission was previously granted).
- Main refuses `audio.start` unless permission status is `granted`.
- Recording only begins after an explicit **Start** action.

---

## Device management

1. Renderer enumerates `audioinput` devices via `navigator.mediaDevices`.
2. Device list is pushed to main with `audio.setDevices` (Zod-validated).
3. User selects a device; main stores `selectedDeviceId` on `AudioCaptureController`.
4. Unknown device IDs are rejected.
5. Refresh re-enumerates devices after permission changes (labels often empty before grant).

No mixing, loopback, or multi-device capture in this phase.

---

## Lifecycle

| State | Meaning |
|-------|---------|
| `idle` | No capture |
| `requesting_permission` | Explicit permission flow in progress |
| `ready` | Permission granted; may start |
| `starting` | Main accepted start; renderer opening MediaStream |
| `active` | Microphone capturing; chunks may flow |
| `paused` | Capture paused; stream may remain open locally |
| `stopping` / `stopped` | Tear-down |
| `error` | Capture failure |

Invalid transitions throw `AudioCaptureError`.

Session integration:

- Session start does **not** auto-start audio.
- Session stop **always** calls `AudioHost.forceStopFromSession()` and emits `audio:force-stop` so the renderer releases MediaStream tracks.

---

## IPC

### Invokes

- `audio:get-devices` / `audio:set-devices` / `audio:select-device`
- `audio:begin-permission` / `audio:set-permission` / `audio:get-status`
- `audio:start` / `audio:confirm-active` / `audio:pause` / `audio:resume` / `audio:stop`
- `audio:push-chunk` / `audio:capture-error`
- `transcript:get-recent` / `transcript:get-snapshot` / `transcript:clear` / `transcript:get-status`
- `stt:get-status`

### Events

- `audio:status-changed`
- `audio:force-stop`
- `transcript:partial` / `transcript:final` / `transcript:error`
- `stt:status-changed`

All invokes use existing sender/origin validation. Chunk payloads are Zod-validated. Raw PCM is never logged.

### Preload surface

```ts
window.companyAI.audio.*
window.companyAI.transcript.*
window.companyAI.stt.*
```

Does not expose `ipcRenderer`, `MediaStream`, Node APIs, or internal services.

---

## Transcript model

`TranscriptSegment`: id, text, timestamps, `isFinal`, confidence.

`TranscriptStore`:

- `applyPartial` replaces in-place (same id)
- `commitFinal` clears partial and appends final
- Bounded `maxFinals` (default 200)
- `clear` / `getRecent` / `getSnapshot` / `getStatus`

---

## STT provider abstraction

```ts
interface STTProvider {
  connect(): Promise<void>;
  sendAudio(chunk: AudioChunk): Promise<void>;
  onPartialTranscript(cb): Unsubscribe;
  onFinalTranscript(cb): Unsubscribe;
  onStatus(cb): Unsubscribe;
  disconnect(): Promise<void>;
  getStatus(): STTProviderStatus;
}
```

Phase 2A ships `MockSTTProvider` only: ignores PCM bytes, emits deterministic partial/final events from chunk counts. No vendor SDKs.

---

## Security considerations

| Control | Status |
|---------|--------|
| Explicit mic permission | Required |
| Visible mic active indicator | UI badge |
| No auto-start on launch | Enforced |
| No raw audio on disk by default | Enforced |
| No raw audio / full transcript in logs | Redaction + logging policy |
| Typed IPC + Zod | Enforced |
| Electron isolation defaults unchanged | Preserved |
| Session stop ends capture | Enforced |

---

## Current limitations

1. Mock STT only — not real speech recognition.
2. Renderer uses `ScriptProcessorNode` (simple; may move to AudioWorklet later).
3. No system/loopback audio.
4. No audio persistence / export.
5. No question detection or AI responses.
6. Device hot-plug is refresh-based, not fully reactive.
7. Pause keeps local MediaStream open until Stop / force-stop.

---

## Next phase (2B — complete)

See `docs/stt-architecture.md`. Deepgram streaming STT replaces mock for production paths; `MockSTTProvider` remains for tests.
