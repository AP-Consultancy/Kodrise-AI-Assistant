import type { DocumentExtractionInput, DocumentExtractionResult, DocumentExtractor } from './DocumentExtractor';
import { detectFormat } from './DocumentExtractor';

export class TextDocumentExtractor implements DocumentExtractor {
  canHandle(input: DocumentExtractionInput): boolean {
    const format = detectFormat(input.fileName, input.mimeType);
    return format === 'txt' || format === 'md';
  }

  async extract(input: DocumentExtractionInput): Promise<DocumentExtractionResult> {
    const format = detectFormat(input.fileName, input.mimeType);
    if (format !== 'txt' && format !== 'md') {
      return {
        format: 'unsupported',
        text: '',
        unsupportedReason: 'File type not supported.',
      };
    }
    const text = Buffer.from(input.bytes).toString('utf8');
    return { format, text };
  }
}
