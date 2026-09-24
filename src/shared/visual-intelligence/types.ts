export type VisualRelevance = 'RELEVANT' | 'NOT_RELEVANT' | 'UNKNOWN';

export type VisualIntelligenceState =
  | 'idle'
  | 'ocr_running'
  | 'vision_running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface VisualIntelligencePublicConfig {
  enabled: boolean;
  ocr: {
    enabled: boolean;
    provider: 'mock' | 'openai';
    maxCharacters: number;
  };
  vision: {
    enabled: boolean;
    provider: 'mock' | 'openai';
    model: string;
  };
  maxAnalysisFrames: number;
  analysisTimeoutMs: number;
  autoAnalyzeOnCapture: boolean;
  autoAnalyzeOnQuestion: boolean;
}

export const DEFAULT_VISUAL_INTELLIGENCE_CONFIG: VisualIntelligencePublicConfig = {
  enabled: false,
  ocr: {
    enabled: true,
    provider: 'openai',
    maxCharacters: 4000,
  },
  vision: {
    enabled: true,
    provider: 'openai',
    model: 'gpt-4o-mini',
  },
  maxAnalysisFrames: 2,
  analysisTimeoutMs: 45_000,
  autoAnalyzeOnCapture: false,
  autoAnalyzeOnQuestion: true,
};

export interface VisualIntelligenceStatus {
  enabled: boolean;
  state: VisualIntelligenceState;
  ocrEnabled: boolean;
  visionEnabled: boolean;
  ocrProvider: string;
  visionProvider: string;
  ocrAvailable: string;
  visionAvailable: string;
  model: string | null;
  lastOcrAt: number | null;
  lastVisionAt: number | null;
  lastProcessingTimeMs: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  ocrResultCount: number;
  visionAnalysisCount: number;
  activeRequestId: string | null;
}

export type VisualIntelligenceEventType =
  | 'visual.ocr.started'
  | 'visual.ocr.completed'
  | 'visual.ocr.failed'
  | 'visual.vision.started'
  | 'visual.vision.completed'
  | 'visual.vision.failed'
  | 'visual.intelligence.updated';

export interface VisualIntelligenceEvent {
  type: VisualIntelligenceEventType;
  timestamp: number;
  frameId?: string;
  requestId?: string;
  code?: string;
  message?: string;
  latencyMs?: number;
  contentType?: string;
}
