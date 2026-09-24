# Context Engine — Phase 2D

> Input: classified `DetectedQuestion` + bounded transcript/question history  
> Output: `ContextSnapshot` for a future AI orchestrator  
> No LLM, embeddings, RAG, or network calls

---

## Pipeline

```
Question classified
        ↓
ContextEngine.buildForQuestion
        ↓
Providers (transcript / questions / user / project)
        ↓
Deduplicate
        ↓
Prioritize + budget
        ↓
ContextSnapshot (+ quality / truncation metadata)
        ↓
IPC events → diagnostics UI
```

---

## Sources (Phase 2D)

| Source | Status |
|--------|--------|
| Transcript | Implemented (bounded window) |
| Question history | Implemented |
| Session ids | Implemented |
| User context | Explicit public config only |
| Project context | Explicit public config only |
| Documents / screen / RAG | Reserved — not implemented |

---

## Prioritization (selection only)

1. Current question  
2. Parent / related questions  
3. Recent relevant transcript  
4. Recent unrelated questions  
5. Project context  
6. User context  
7. Older conversation (dropped first under budget)

---

## Budget defaults

Configured under `publicConfig.context.budget`:

- `maxTranscriptSegments`: 12  
- `maxTranscriptCharacters`: 2400  
- `maxQuestionCount`: 6  
- `maxRelatedQuestions`: 3  
- `maxContextCharacters`: 6000  
- `maxRecentSnapshots`: 20  

Truncation is recorded in `metadata.truncated` and omission counters.

---

## Security

- No credentials/API keys in snapshots  
- User preference keys matching secret patterns are stripped  
- Logs emit ids/metrics only — not full transcript or context bodies  
- Explicit user/project context only — no filesystem scanning  

---

## IPC

```
window.companyAI.context.getCurrent()
window.companyAI.context.getRecent()
window.companyAI.context.clear()
window.companyAI.context.getStatus()
window.companyAI.context.onCreated / onUpdated / onTruncated
```

---

## Limitations

1. Character-based budgeting (not model token counting)  
2. No semantic relevance ranking  
3. No document/screen/RAG sources yet  
4. Diagnostics UI only — not a polished end-user surface  
