export type OCRCapabilityStatus =
  | 'SUPPORTED'
  | 'PARTIAL'
  | 'UNSUPPORTED'
  | 'NOT_CONFIGURED'
  | 'ERROR';

export interface OCRBoundingRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  text?: string;
}

export interface OCRCapabilities {
  available: OCRCapabilityStatus;
  providerName: string;
  supportedLanguages: string[];
  supportsBoundingBoxes: boolean;
  maxImageBytes: number;
  maxWidth: number;
  maxHeight: number;
}

export type OCRResultStatus = 'completed' | 'empty' | 'failed' | 'cancelled';

export interface OCRResult {
  id: string;
  sourceFrameId: string;
  text: string;
  confidence: number;
  language: string | null;
  processingTimeMs: number;
  createdAt: number;
  boundingRegions: OCRBoundingRegion[];
  status: OCRResultStatus;
}

export interface OCRPublicConfig {
  enabled: boolean;
  provider: 'mock' | 'openai';
  maxCharacters: number;
}
