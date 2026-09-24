export type VisionCapabilityStatus =
  | 'SUPPORTED'
  | 'PARTIAL'
  | 'UNSUPPORTED'
  | 'NOT_CONFIGURED'
  | 'ERROR';

export type VisionContentType =
  | 'CODE'
  | 'ERROR_MESSAGE'
  | 'TERMINAL'
  | 'DIAGRAM'
  | 'ARCHITECTURE'
  | 'UI'
  | 'TABLE'
  | 'DOCUMENT'
  | 'PRESENTATION'
  | 'IMAGE'
  | 'UNKNOWN';

export interface VisionCapabilities {
  available: VisionCapabilityStatus;
  providerName: string;
  supportsImageInput: boolean;
  supportsOCRContext: boolean;
  supportsStructuredOutput: boolean;
  maxImageBytes: number;
  maxWidth: number;
  maxHeight: number;
}

export interface VisionTechnicalElement {
  kind: string;
  value: string;
  confidence: number;
}

export interface VisionAnalysis {
  id: string;
  sourceFrameId: string;
  description: string;
  contentType: VisionContentType;
  confidence: number;
  relevantText: string;
  technicalElements: VisionTechnicalElement[];
  detectedEntities: string[];
  warnings: string[];
  processingTimeMs: number;
  createdAt: number;
  status: 'completed' | 'failed' | 'cancelled';
}

export type VisionAnalysisMode = 'general' | 'technical' | 'question_aware';

export interface VisionAnalysisRequest {
  requestId: string;
  frameId: string;
  mimeType: string;
  /** Base64 without data-URL prefix — main-process only. */
  imageBase64: string;
  width: number;
  height: number;
  ocrText?: string | null;
  questionText?: string | null;
  questionType?: string | null;
  relevantTranscript?: string | null;
  mode: VisionAnalysisMode;
}

export interface VisionPublicConfig {
  enabled: boolean;
  provider: 'mock' | 'openai';
  model: string;
}
