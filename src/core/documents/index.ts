import type { DocumentExtractionInput, DocumentExtractionResult, DocumentExtractor } from './DocumentExtractor';
import { detectFormat } from './DocumentExtractor';
import { TextDocumentExtractor } from './TextDocumentExtractor';
import { DocxDocumentExtractor } from './DocxDocumentExtractor';
import { PdfDocumentExtractor } from './PdfDocumentExtractor';

export class CompositeDocumentExtractor implements DocumentExtractor {
  private readonly extractors: DocumentExtractor[];

  constructor(extractors?: DocumentExtractor[]) {
    this.extractors = extractors ?? [
      new TextDocumentExtractor(),
      new DocxDocumentExtractor(),
      new PdfDocumentExtractor(),
    ];
  }

  canHandle(input: DocumentExtractionInput): boolean {
    return this.extractors.some((extractor) => extractor.canHandle(input));
  }

  async extract(input: DocumentExtractionInput): Promise<DocumentExtractionResult> {
    const format = detectFormat(input.fileName, input.mimeType);
    if (format === 'unsupported') {
      return {
        format: 'unsupported',
        text: '',
        unsupportedReason: "This file type isn't supported.",
      };
    }
    const extractor = this.extractors.find((item) => item.canHandle(input));
    if (!extractor) {
      return {
        format: 'unsupported',
        text: '',
        unsupportedReason: "This file type isn't supported.",
      };
    }
    try {
      return await extractor.extract(input);
    } catch {
      return {
        format: 'unsupported',
        text: '',
        unsupportedReason:
          format === 'pdf'
            ? 'This PDF could not be processed.'
            : format === 'docx'
              ? 'This Word document could not be processed.'
              : 'Could not read this document.',
      };
    }
  }
}

export type { DocumentExtractor, DocumentExtractionInput, DocumentExtractionResult } from './DocumentExtractor';
export { detectFormat, extensionOf } from './DocumentExtractor';
export { TextDocumentExtractor } from './TextDocumentExtractor';
export { DocxDocumentExtractor } from './DocxDocumentExtractor';
export { PdfDocumentExtractor } from './PdfDocumentExtractor';
export {
  DocumentRelevanceSelector,
  toInterviewDocumentContext,
} from './DocumentRelevanceSelector';
export type { DocumentCandidate } from './DocumentRelevanceSelector';
