import type {
  InterviewDocumentLimits,
  InterviewSessionContext,
  InterviewSessionContextPublic,
  SessionDocument,
  SessionDocumentKind,
  SessionDocumentMeta,
} from '../../shared/interview/types';
import { DEFAULT_INTERVIEW_DOCUMENT_LIMITS } from '../../shared/interview/types';
import { AppError } from '../../shared/errors';
import { createDefaultIdGenerator, type IdGenerator } from '../../shared/session/types';
import {
  CompositeDocumentExtractor,
  type DocumentExtractor,
} from '../documents';

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\0')
    .join('')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateText(text: string, maxCharacters: number): { text: string; truncated: boolean } {
  if (text.length <= maxCharacters) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxCharacters)}\n…[document truncated]`,
    truncated: true,
  };
}

function toMeta(doc: SessionDocument): SessionDocumentMeta {
  const { text: _text, ...meta } = doc;
  return meta;
}

function friendlyExtractionError(format: string, error: unknown): AppError {
  const cause = error instanceof Error ? error.message : 'unknown';
  if (format === 'pdf') {
    return new AppError('VALIDATION', 'This PDF could not be processed.', {
      details: { code: 'DOCUMENT_PDF_FAILED', cause },
    });
  }
  if (format === 'docx') {
    return new AppError('VALIDATION', 'This Word document could not be processed.', {
      details: { code: 'DOCUMENT_DOCX_FAILED', cause },
    });
  }
  return new AppError('VALIDATION', 'Could not read this document.', {
    details: { code: 'DOCUMENT_EXTRACT_FAILED', cause },
  });
}

/**
 * Session-scoped document store. Holds bounded extracted text only.
 */
export class InterviewSessionContextStore {
  private resume: SessionDocument | null = null;
  private jobDescription: SessionDocument | null = null;
  private additional: SessionDocument[] = [];
  private readonly createId: IdGenerator;
  private readonly extractor: DocumentExtractor;
  private readonly limits: InterviewDocumentLimits;

  constructor(options?: {
    idGenerator?: IdGenerator;
    extractor?: DocumentExtractor;
    limits?: InterviewDocumentLimits;
  }) {
    this.createId = options?.idGenerator ?? createDefaultIdGenerator();
    this.extractor = options?.extractor ?? new CompositeDocumentExtractor();
    this.limits = options?.limits ?? DEFAULT_INTERVIEW_DOCUMENT_LIMITS;
  }

  clear(): void {
    this.resume = null;
    this.jobDescription = null;
    this.additional = [];
  }

  getPublic(): InterviewSessionContextPublic {
    return {
      resume: this.resume ? toMeta(this.resume) : null,
      jobDescription: this.jobDescription ? toMeta(this.jobDescription) : null,
      additionalDocuments: this.additional.map(toMeta),
      documentCount:
        (this.resume ? 1 : 0) + (this.jobDescription ? 1 : 0) + this.additional.length,
      totalCharacters:
        (this.resume?.characterCount ?? 0) +
        (this.jobDescription?.characterCount ?? 0) +
        this.additional.reduce((sum, doc) => sum + doc.characterCount, 0),
    };
  }

  getContext(): InterviewSessionContext {
    const publicMeta = this.getPublic();
    return {
      ...publicMeta,
      resume: this.resume,
      jobDescription: this.jobDescription,
      additionalDocuments: [...this.additional],
      resumeExcerpt: this.resume?.text ?? null,
      jobDescriptionExcerpt: this.jobDescription?.text ?? null,
      additionalExcerpts: this.additional.map((doc) => ({
        id: doc.id,
        fileName: doc.fileName,
        text: doc.text,
      })),
    };
  }

  getCandidates(): Array<{
    id: string;
    fileName: string;
    kind: SessionDocumentKind;
    text: string;
    truncated: boolean;
  }> {
    const items: Array<{
      id: string;
      fileName: string;
      kind: SessionDocumentKind;
      text: string;
      truncated: boolean;
    }> = [];
    if (this.resume) {
      items.push({
        id: this.resume.id,
        fileName: this.resume.fileName,
        kind: 'resume',
        text: this.resume.text,
        truncated: this.resume.truncated,
      });
    }
    if (this.jobDescription) {
      items.push({
        id: this.jobDescription.id,
        fileName: this.jobDescription.fileName,
        kind: 'job_description',
        text: this.jobDescription.text,
        truncated: this.jobDescription.truncated,
      });
    }
    for (const doc of this.additional) {
      items.push({
        id: doc.id,
        fileName: doc.fileName,
        kind: 'additional',
        text: doc.text,
        truncated: doc.truncated,
      });
    }
    return items;
  }

  async addDocument(input: {
    kind: SessionDocumentKind;
    fileName: string;
    mimeType: string | null;
    bytes: Uint8Array;
  }): Promise<SessionDocumentMeta> {
    if (input.bytes.byteLength === 0) {
      throw new AppError('VALIDATION', 'This file is empty.', {
        details: { code: 'DOCUMENT_EMPTY_FILE' },
      });
    }

    if (input.bytes.byteLength > this.limits.maxFileBytes) {
      throw new AppError('VALIDATION', 'This document is too large.', {
        details: { code: 'DOCUMENT_TOO_LARGE' },
      });
    }

    let extracted;
    try {
      extracted = await this.extractor.extract({
        fileName: input.fileName,
        mimeType: input.mimeType,
        bytes: input.bytes,
      });
    } catch (error) {
      const format = input.fileName.toLowerCase().endsWith('.pdf')
        ? 'pdf'
        : input.fileName.toLowerCase().endsWith('.docx')
          ? 'docx'
          : 'other';
      throw friendlyExtractionError(format, error);
    }

    if (extracted.format === 'unsupported') {
      throw new AppError(
        'VALIDATION',
        extracted.unsupportedReason ?? "This file type isn't supported.",
        { details: { code: 'DOCUMENT_UNSUPPORTED' } },
      );
    }

    const maxChars =
      input.kind === 'resume'
        ? this.limits.maxResumeCharacters
        : input.kind === 'job_description'
          ? this.limits.maxJobDescriptionCharacters
          : this.limits.maxAdditionalCharactersPerDoc;

    const normalized = normalizeExtractedText(extracted.text);
    if (!normalized) {
      throw new AppError(
        'VALIDATION',
        "Some document content couldn't be extracted.",
        { details: { code: 'DOCUMENT_EMPTY' } },
      );
    }

    const bounded = truncateText(normalized, maxChars);
    const now = Date.now();
    const document: SessionDocument = {
      id: this.createId(),
      kind: input.kind,
      fileName: input.fileName,
      format: extracted.format,
      size: input.bytes.byteLength,
      byteSize: input.bytes.byteLength,
      source: 'file_picker',
      status: 'ready',
      extractedTextLength: bounded.text.length,
      createdAt: now,
      updatedAt: now,
      uploadedAt: now,
      characterCount: bounded.text.length,
      truncated: bounded.truncated,
      errorMessage: null,
      text: bounded.text,
    };

    if (input.kind === 'resume') {
      this.resume = document;
    } else if (input.kind === 'job_description') {
      this.jobDescription = document;
    } else {
      if (this.additional.length >= this.limits.maxAdditionalDocuments) {
        throw new AppError(
          'VALIDATION',
          `You can add up to ${this.limits.maxAdditionalDocuments} supporting documents.`,
          { details: { code: 'DOCUMENT_LIMIT' } },
        );
      }
      this.additional.push(document);
    }

    return toMeta(document);
  }

  removeDocument(id: string): InterviewSessionContextPublic {
    if (this.resume?.id === id) {
      this.resume = null;
    } else if (this.jobDescription?.id === id) {
      this.jobDescription = null;
    } else {
      this.additional = this.additional.filter((doc) => doc.id !== id);
    }
    return this.getPublic();
  }
}
