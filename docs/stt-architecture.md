# STT Architecture — Phase 2B

> Project: AP AI Assistance Tool  
> Scope: Real-time microphone → Deepgram streaming STT → live transcript  
> Out of scope: question detection, LLM answers, screen capture, OCR, RAG

---

## Selected provider

**Deepgram Listen (streaming WebSocket)**

| Topic | Detail |
|-------|--------|
| Why | Matches Phase 2A PCM Int16 LE / 16 kHz / mono as `linear16` with no resampling |
| Dependency | `ws` (WebSocket client). Deepgram Listen REST/WSS API — no vendor SDK in `core/` or renderer |
| Auth | API key via CredentialVault key `stt.deepgram.apiKey` (main only) |
| Streaming | Interim + final results over `wss://api.deepgram.com/v1/listen` |
| Audio format | `encoding=linear16`, `sample_rate=16000`, `channels=1` |
| Latency | Typically ~200–500 ms for partials (network + model dependent) |
| Credentials in main? | Yes — vault decrypt + Authorization header never leave main |

---

## Abstraction

```
core/stt/STTProvider.ts          # interface only
core/stt/MockSTTProvider.ts      # tests / offline
core/audio/AudioFormatAdapter.ts # capture → STT bytes
main/transcription/provider/
  DeepgramSTTProvider.ts         # Deepgram adapter (uses ws)
  createSttProvider.ts           # factory from public config
```

`core` does not import `ws` or Deepgram packages.

---

## Credentials

- Stored with Electron `safeStorage` under `stt.deepgram.apiKey`
- Renderer may `credentials.set` / `has` / `delete` — receives `{ configured }` only
- `getCredential` exists on the vault for main-process provider use and is **not** exposed over IPC
- Missing key → `STTConfigurationError`

---

## Public configuration (`config.stt`)

```json
{
  "provider": "deepgram",
  "model": "nova-3",
  "language": "en",
  "sampleRate": 16000,
  "channels": 1,
  "interimResults": true,
  "endpoint": "wss://api.deepgram.com/v1/listen"
}
```

No secrets in `public-config.json`. Older configs without `stt` are merged with defaults.

---

## Audio format

| Stage | Format |
|-------|--------|
| Capture | PCM signed 16-bit LE, mono, 16 kHz (`ScriptProcessor` frames) |
| IPC | base64 of PCM (`AudioChunkDto`) — not logged |
| Adapter | Passthrough when rates/channels match Deepgram linear16 |
| Wire | Binary WebSocket frames to Deepgram |

Mismatch throws `STTAudioFormatError`. No silent resampling in Phase 2B.

---

## Streaming lifecycle

```
disconnected → connecting → connected → streaming
                     ↘ error
connected/streaming → reconnecting → connected (bounded retries)
session/app stop → disconnect → disconnected
```

Reconnection: max 3 attempts, exponential backoff (500 ms × 2^n, capped), cancellable via `disconnect()`.

Backpressure: if `bufferedAmount` exceeds 256 KB, chunks are dropped (count logged, not audio).

---

## Transcripts

- Partials replace in place (`TranscriptStore.applyPartial`)
- Finals commit once; identical consecutive finals are ignored
- Provider start/duration offsets map to `startTime` / `endTime` when present
- Confidence preserved when Deepgram supplies it; otherwise `null`
- History bounded (`maxFinals`)

---

## Errors

| Error | When |
|-------|------|
| `STTConfigurationError` | Missing key / bad provider config |
| `STTAuthenticationError` | HTTP 401/403 from Deepgram |
| `STTConnectionError` | Socket/network failures |
| `STTTimeoutError` | Connect timeout |
| `STTProviderError` | Unsupported runtime config |
| `STTAudioFormatError` | Chunk format mismatch |

Renderer receives `{ code, message, recoverable }` only.

---

## Testing

- Unit: mock provider, Deepgram with fake WebSocket, format adapter, transcript duplicate/timing, config merge, credential IPC shape
- Integration: `tests/integration/deepgram-stt.integration.test.ts` runs only when `DEEPGRAM_API_KEY` is set; otherwise skipped

---

## Security

- Provider SDK/client only in main
- No API keys in renderer state after save (password field cleared)
- No raw audio / full transcript logging
- Existing Electron isolation + IPC validation unchanged

---

## Limitations

1. Single provider (Deepgram); `mock` for tests/offline
2. English default; other languages via config only
3. No automatic language detection
4. Requires network + valid Deepgram key for real transcripts
5. Pause disconnects Deepgram and reconnects on resume (avoids idle 1011 closes)
6. No offline/local STT model in this phase
