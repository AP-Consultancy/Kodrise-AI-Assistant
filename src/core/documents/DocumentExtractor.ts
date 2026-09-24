import type { SessionDocumentFormat } from '../../shared/interview/types';

export interface DocumentExtractionInput {
  fileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
}

export interface DocumentExtractionResult {
  format: SessionDocumentFormat;
  text: string;
  unsupportedReason?: string;
}

export interface DocumentExtractor {
  canHandle(input: DocumentExtractionInput): boolean;
  extract(input: DocumentExtractionInput): Promise<DocumentExtractionResult>;
}

export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index < 0) return '';
  return fileName.slice(index).toLowerCase();
}

export function detectFormat(fileName: string, mimeType: string | null): SessionDocumentFormat {
  const ext = extensionOf(fileName);
  if (ext === '.pdf' || mimeType === 'application/pdf') return 'pdf';
  if (
    ext === '.docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (ext === '.txt' || mimeType === 'text/plain') return 'txt';
  if (ext === '.md' || ext === '.markdown' || mimeType === 'text/markdown') return 'md';
  return 'unsupported';
}
