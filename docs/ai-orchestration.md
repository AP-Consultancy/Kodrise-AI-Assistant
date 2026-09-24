# AI Orchestration — Phase 2E

> Input: classified question + `ContextSnapshot`  
> Output: streamed `AIResponseState`  
> No RAG, embeddings, tools, agents, or screen capture

---

## Provider selection

| Choice | Detail |
|--------|--------|
| Provider | **OpenAI** |
| SDK | `openai` (main process only) |
| Why | Streaming chat completions, AbortController cancel, API-key auth fits existing CredentialVault pattern used by Deepgram STT |
| Auth | CredentialVault key `ai.openai.apiKey` — never returned to renderer |
| Limitations | Network required; rate limits; model allowlist is config-driven; no vision/tools in this phase |

`mock` provider is available for offline tests and diagnostics.

---

## Pipeline

```
Question classified
        ↓
ContextEngine → ContextSnapshot
        ↓
PromptBuilder (system + user messages)
        ↓
AIOrchestrator → AIRequest
        ↓
AIProvider.generate() (AsyncIterable<AIChunk>)
        ↓
AIResponseManager (state + latency)
        ↓
Typed IPC events → renderer streaming UI
```

---

## Response modes

| Mode | Behavior |
|------|----------|
| `short` | Direct answer, minimal explanation |
| `normal` | Answer + concise explanation + example when helpful |
| `detailed` | Answer + explanation + example + trade-offs |

Configured via `publicConfig.ai.responseMode`.

---

## Auto-generate

`publicConfig.ai.autoGenerate` defaults to **`false`** (conservative).

When enabled:

- runs only after a classified (final) question
- requires `classificationConfidence >= minClassificationConfidence`
- skips duplicate `questionId` generations
- skips if another generation is already active

Manual **Generate Answer** uses the same orchestrator with `force: true`.

---

## Public config (non-secret)

```json
{
  "ai": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "responseMode": "normal",
    "temperature": 0.4,
    "maxOutputTokens": 800,
    "autoGenerate": false,
    "minClassificationConfidence": 0.7,
    "maxResponseHistory": 20
  }
}
```

---

## IPC

```
ai.getStatus()
ai.getConfiguration()   // configured:boolean, never the key
ai.generate(questionId)
ai.cancel(requestId?)
ai.getCurrentResponse()
ai.clearResponse()
```

Events: `ai.request.started`, `ai.response.started|chunk|completed|cancelled|error`

---

## Security

- API keys only in CredentialVault (main)
- Logs: request/response ids, latency, codes — not prompts, answers, or secrets
- Provider SDK never imported in renderer/preload
- Zod validation + sender/origin checks on all AI IPC

### Configuring the OpenAI key

1. Open the app diagnostics view and scroll to **AI Orchestration**.
2. Enter your key in **OpenAI API key** (password field).
3. Click **Save key** — this calls `credentials.set('ai.openai.apiKey', …)` into Electron `safeStorage`.
4. The draft field clears; status shows **Configured**. The secret is never read back into the UI.

Same vault path as Deepgram (`stt.deepgram.apiKey` in Audio / Transcript).

---

## Latency metadata

- `latencyMs` — start → complete
- `timeToFirstTokenMs` — start → first non-empty chunk

---

## Limitations

- Single active generation per session
- No RAG / embeddings / tool calling
- No Anthropic/Gemini adapters yet (interface is ready)
- OpenAI usage token counts not yet attached from stream (state supports usage field)
