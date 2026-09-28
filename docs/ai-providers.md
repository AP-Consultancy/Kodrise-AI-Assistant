# AI Providers — Phase 2N

Supported answer engines share one orchestration pipeline. The renderer and
`AIOrchestrator` never import vendor SDKs.

## Supported providers

| Provider | Id | SDK (main only) | Credential vault key |
|----------|----|-----------------|----------------------|
| Mock AI | `mock` | none | none (offline / E2E) |
| OpenAI | `openai` | `openai` | `ai.openai.apiKey` |
| Google Gemini | `gemini` | `@google/genai` | `ai.gemini.apiKey` |

Default provider remains **`openai`** so existing installations are unchanged.

## Architecture

```
AIOrchestrator
      ↓
createAiProvider(config)
      ↓
AIProvider
 ├── MockAIProvider
 ├── OpenAIProvider
 └── GeminiProvider
```

- `PromptBuilder` → logical `AIRequest` (system + user messages + metadata)
- Provider adapters map that request to the vendor API
- Streaming yields the same `AIChunk` contract (`text`, `isFinal`, `sequence`)
- Answer UI does not know which provider produced the stream

## Gemini setup

1. Open **Settings** → **Answer engine** → choose **Gemini**.
2. Confirm **Gemini Model** (default: `gemini-3.8-flash`).
3. Paste a Gemini API key into **Gemini API Key** → **Save**.
4. Status should show **✓ Gemini configured** (key is never displayed again).
5. Click **Test Connection** (requires network + valid key).

Keys are stored with Electron `safeStorage` via `CredentialVault`. They are never
written to `publicConfig`, renderer state, logs, prompts, or URLs.

## Public config vs secrets

**Public (non-secret):**

```json
{
  "ai": {
    "provider": "gemini",
    "model": "gemini-3.8-flash",
    "responseMode": "normal",
    "temperature": 0.4,
    "maxOutputTokens": 800,
    "autoGenerate": false
  }
}
```

**Vault (secret):**

- `ai.openai.apiKey`
- `ai.gemini.apiKey`

Never put `apiKey` inside public config.

## Streaming and cancellation

Gemini uses `@google/genai` `models.generateContentStream` with `abortSignal`.
Cancel / Pause / End Interview / New Interview abort the active controller the
same way as OpenAI. Cancelled streams do not emit a provider error to the UI.

## Capabilities

Current Gemini adapter capabilities:

| Capability | Supported |
|------------|-----------|
| Text generation | yes |
| Streaming | yes |
| Vision / multimodal frames | no (text pipeline only) |
| Structured output | no |

Unsupported capabilities return a typed provider error — there is no silent
fallback to another provider.

## Error messages (sanitized)

| Condition | Friendly message |
|-----------|------------------|
| Missing key | Gemini API key is not configured |
| Invalid key | Gemini API key is invalid. |
| Quota | Gemini quota has been exceeded. |
| Rate limit | Gemini rate limit exceeded. Try again shortly. |
| Model missing | Gemini model is unavailable. |
| Network | Unable to connect to Gemini. |
| Service | Gemini is temporarily unavailable. |

Raw SDK stacks and API keys are never shown.

## Test Connection

IPC: `ai:test-connection` → main → provider probe → sanitized result:

- `success`, `provider`, `status` (`pass` \| `fail` \| `not_configured` \| …)
- `message`, optional `latencyMs`, `model`
- Never returns credentials

PASS requires a successful probe request, not merely a stored key.

## MockAI testing

Use `provider: "mock"` for deterministic offline interviews and unit/E2E tests.
MockAI does not require Gemini/OpenAI keys, network, or the Gemini SDK.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| ○ Gemini API key not configured | Save key in Settings; confirm vault storage is available |
| Test Connection fails auth | Regenerate key in Google AI Studio; re-save |
| Model unavailable | Update **Gemini Model** in Settings (default is `gemini-3.8-flash`; `gemini-2.5-flash` is restricted for many new API keys) |
| Answers still from OpenAI | Confirm Answer engine is set to Gemini and restart generation |
| OpenAI regressions | Switch provider back to OpenAI; OpenAI vault key is unchanged |

## Related docs

- [ai-orchestration.md](./ai-orchestration.md) — shared pipeline, IPC, response modes
- [mvp-stabilization.md](./mvp-stabilization.md) — MockAI for automated tests
