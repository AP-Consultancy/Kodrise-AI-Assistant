import mammoth from 'mammoth';
import type { DocumentExtractionInput, DocumentExtractionResult, DocumentExtractor } from './DocumentExtractor';
import { detectFormat } from './DocumentExtractor';

export class DocxDocumentExtractor implements DocumentExtractor {
  canHandle(input: DocumentExtractionInput): boolean {
    return detectFormat(input.fileName, input.mimeType) === 'docx';
  }

  async extract(input: DocumentExtractionInput): Promise<DocumentExtractionResult> {
    if (!this.canHandle(input)) {
      return { format: 'unsupported', text: '', unsupportedReason: 'File type not supported.' };
    }
    const result = await mammoth.extractRawText({ buffer: Buffer.from(input.bytes) });
    return { format: 'docx', text: result.value ?? '' };
  }
}
