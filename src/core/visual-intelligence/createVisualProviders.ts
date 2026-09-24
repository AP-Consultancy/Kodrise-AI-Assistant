import type { OCRProvider } from '../ocr/OCRProvider';
import type { VisionProvider } from '../vision/VisionProvider';
import { MockOCRProvider } from '../ocr/MockOCRProvider';
import { MockVisionProvider } from '../vision/MockVisionProvider';
import type { VisualIntelligencePublicConfig } from '../../shared/visual-intelligence/types';

export interface CreateVisualProvidersOptions {
  config: VisualIntelligencePublicConfig;
  createOpenAiOcr?: () => OCRProvider;
  createOpenAiVision?: () => VisionProvider;
}

export function createOCRProvider(options: CreateVisualProvidersOptions): OCRProvider {
  if (options.config.ocr.provider === 'mock') {
    return new MockOCRProvider();
  }
  if (options.createOpenAiOcr) {
    return options.createOpenAiOcr();
  }
  return new MockOCRProvider();
}

export function createVisionProvider(options: CreateVisualProvidersOptions): VisionProvider {
  if (options.config.vision.provider === 'mock') {
    return new MockVisionProvider();
  }
  if (options.createOpenAiVision) {
    return options.createOpenAiVision();
  }
  return new MockVisionProvider();
}
