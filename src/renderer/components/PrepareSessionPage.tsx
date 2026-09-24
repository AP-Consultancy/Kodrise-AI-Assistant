import { useEffect, useState } from 'react';
import type {
  InterviewSessionContextPublic,
  InterviewStatus,
  SessionDocumentMeta,
} from '../../shared/interview/types';
import { documentTypeLabel, toDocumentType } from '../../shared/interview/documentTypes';
import './prepareSession.css';

interface PrepareSessionProps {
  onStarted: () => void;
}

export function PrepareSessionPage({ onStarted }: PrepareSessionProps) {
  const [docs, setDocs] = useState<InterviewSessionContextPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const result = await window.companyAI.interview.getDocuments();
    if (result.ok) setDocs(result.data);
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      void (async () => {
        const result = await window.companyAI.interview.getDocuments();
        if (!cancelled && result.ok) setDocs(result.data);
      })();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function upload(kind: 'resume' | 'job_description' | 'additional') {
    setBusy(true);
    setError(null);
    try {
      const result = await window.companyAI.interview.pickDocument(kind);
      if (!result.ok) {
        if (result.error.message === 'No file selected.') {
          return;
        }
        setError(toFriendlyDocumentError(result.error.message));
        return;
      }
      await refresh();
    } catch (err) {
      setError(toFriendlyDocumentError(err instanceof Error ? err.message : 'Document upload failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await window.companyAI.interview.removeDocument(id);
      if (!result.ok) {
        setError(toFriendlyDocumentError(result.error.message));
        return;
      }
      setDocs(result.data);
    } finally {
      setBusy(false);
    }
  }

  async function startInterview() {
    setBusy(true);
    setError(null);
    try {
      const result = await window.companyAI.interview.start();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onStarted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="prepare" aria-labelledby="prepare-title">
      <header className="prepare__hero">
        <p className="prepare__eyebrow">AP AI Assistant</p>
        <h1 id="prepare-title">Prepare Interview</h1>
        <p className="prepare__lede">
          Upload your resume and optional documents, then start. Listening and answers run
          automatically.
        </p>
      </header>

      {error ? (
        <p className="prepare__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="prepare__slot">
        <div className="prepare__slot-head">
          <h2>Resume</h2>
          <button type="button" disabled={busy} onClick={() => void upload('resume')}>
            {docs?.resume ? 'Replace Resume' : 'Upload Resume'}
          </button>
        </div>
        {docs?.resume ? (
          <DocumentRow doc={docs.resume} onRemove={() => void remove(docs.resume!.id)} disabled={busy} />
        ) : (
          <p className="prepare__empty">No resume uploaded yet.</p>
        )}
      </div>

      <div className="prepare__slot">
        <div className="prepare__slot-head">
          <h2>Job Description</h2>
          <button type="button" disabled={busy} onClick={() => void upload('job_description')}>
            {docs?.jobDescription ? 'Replace' : 'Upload'}
          </button>
        </div>
        {docs?.jobDescription ? (
          <DocumentRow
            doc={docs.jobDescription}
            onRemove={() => void remove(docs.jobDescription!.id)}
            disabled={busy}
          />
        ) : (
          <p className="prepare__empty">Optional — helps tailor answers to the role.</p>
        )}
      </div>

      <div className="prepare__slot">
        <div className="prepare__slot-head">
          <h2>Supporting Documents</h2>
          <button type="button" disabled={busy} onClick={() => void upload('additional')}>
            Add Document
          </button>
        </div>
        {docs?.additionalDocuments.length ? (
          <ul className="prepare__list">
            {docs.additionalDocuments.map((doc) => (
              <li key={doc.id}>
                <DocumentRow doc={doc} onRemove={() => void remove(doc.id)} disabled={busy} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="prepare__empty">Optional project notes, architecture briefs, or references.</p>
        )}
      </div>

      <div className="prepare__actions">
        <button
          type="button"
          className="prepare__primary"
          disabled={busy}
          onClick={() => void startInterview()}
        >
          Start Interview
        </button>
      </div>
    </section>
  );
}

function DocumentRow(props: {
  doc: SessionDocumentMeta;
  onRemove: () => void;
  disabled: boolean;
}) {
  const statusLabel =
    props.doc.status === 'ready'
      ? props.doc.truncated
        ? 'Ready (trimmed)'
        : 'Ready'
      : props.doc.status === 'failed'
        ? 'Failed'
        : props.doc.status === 'processing'
          ? 'Processing…'
          : 'Pending';
  const typeLabel = documentTypeLabel(toDocumentType(props.doc.kind));

  return (
    <div className="prepare__file">
      <span
        className={
          props.doc.status === 'failed' ? 'prepare__check prepare__check--fail' : 'prepare__check'
        }
        aria-hidden="true"
      >
        {props.doc.status === 'failed' ? '!' : '✓'}
      </span>
      <div className="prepare__file-meta">
        <span className="prepare__file-name">{props.doc.fileName}</span>
        <span className="prepare__file-status">
          {typeLabel} · {statusLabel}
          {props.doc.errorMessage ? ` — ${props.doc.errorMessage}` : ''}
        </span>
      </div>
      <button type="button" disabled={props.disabled} onClick={props.onRemove}>
        Remove
      </button>
    </div>
  );
}

function toFriendlyDocumentError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('too large')) return 'This document is too large.';
  if (lower.includes("isn't supported") || lower.includes('not supported')) {
    return "This file type isn't supported.";
  }
  if (lower.includes('pdf')) return 'This PDF could not be processed.';
  if (lower.includes('word') || lower.includes('docx')) {
    return 'This Word document could not be processed.';
  }
  if (lower.includes('empty') || lower.includes("couldn't be extracted")) {
    return "Some document content couldn't be extracted.";
  }
  if (lower.includes('could not be read') || lower.includes('could not read')) {
    return 'Could not read this document.';
  }
  return message;
}

export type { InterviewStatus };
