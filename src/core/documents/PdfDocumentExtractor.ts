import { PDFParse } from 'pdf-parse';
import type { DocumentExtractionInput, DocumentExtractionResult, DocumentExtractor } from './DocumentExtractor';
import { detectFormat } from './DocumentExtractor';

export class PdfDocumentExtractor implements DocumentExtractor {
  canHandle(input: DocumentExtractionInput): boolean {
    return detectFormat(input.fileName, input.mimeType) === 'pdf';
  }

  async extract(input: DocumentExtractionInput): Promise<DocumentExtractionResult> {
    if (!this.canHandle(input)) {
      return { format: 'unsupported', text: '', unsupportedReason: 'File type not supported.' };
    }
    const parser = new PDFParse({ data: Buffer.from(input.bytes) });
    try {
      const result = await parser.getText();
      return { format: 'pdf', text: result.text ?? '' };
    } finally {
      await parser.destroy();
    }
  }
}
