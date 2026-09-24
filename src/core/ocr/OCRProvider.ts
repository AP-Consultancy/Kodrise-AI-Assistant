import type { VisualFrame } from '../../shared/visual-context/types';
import type { OCRCapabilities, OCRResult } from '../../shared/ocr/types';

export interface OCRProvider {
  getCapabilities(): Promise<OCRCapabilities>;
  recognize(frame: VisualFrame, requestId: string): Promise<OCRResult>;
  cancel(requestId: string): Promise<void>;
}
