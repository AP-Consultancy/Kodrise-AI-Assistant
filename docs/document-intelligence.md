# Document Intelligence — Phase 2J

Upload → extract → bound → select relevant excerpts → existing Context Engine → AI pipeline.

## Supported formats

- PDF (`pdf-parse`)
- DOCX (`mammoth`)
- TXT / MD (UTF-8)

## Session kinds

| Upload slot | Internal kind | Product type |
|-------------|---------------|--------------|
| Resume | `resume` | resume |
| Job Description | `job_description` | job_description |
| Supporting Documents | `additional` | supporting_document |

## Limits (`DEFAULT_INTERVIEW_DOCUMENT_LIMITS`)

- Resume: 6,000 characters
- Job description: 4,000 characters
- Supporting doc: 2,500 characters each (max 5)
- File size: 8 MB

## Relevance

`DocumentRelevanceSelector` (deterministic):

- document type priors
- question type
- keyword overlap
- local text windows

No embeddings / vector DB / second LLM.

## Security

- Documents are untrusted reference data
- Prompt system instructions forbid following document “instructions”
- Document text never enters the system role
- Renderer receives metadata DTOs only (no bytes / paths)

## Pipeline

```
Prepare upload
  → main-process extraction
  → InterviewSessionContextStore
  → Start Interview
  → Question classified
  → ContextBuilder + relevance
  → PromptBuilder
  → AIOrchestrator
```
