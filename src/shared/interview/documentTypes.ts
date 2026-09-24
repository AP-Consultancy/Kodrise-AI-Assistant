import type { SessionDocumentKind } from '../interview/types';

/**
 * Phase 2J document type labels.
 * `supporting_document` is the product name for session kind `additional`.
 */
export type DocumentType = 'resume' | 'job_description' | 'supporting_document' | 'unknown';

export type DocumentProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed';

export function toDocumentType(kind: SessionDocumentKind): DocumentType {
  if (kind === 'additional') return 'supporting_document';
  return kind;
}

export function documentTypeLabel(type: DocumentType): string {
  switch (type) {
    case 'resume':
      return 'Resume';
    case 'job_description':
      return 'Job Description';
    case 'supporting_document':
      return 'Supporting Document';
    default:
      return 'Document';
  }
}
