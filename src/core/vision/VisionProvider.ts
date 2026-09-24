import type {
  VisionAnalysis,
  VisionAnalysisRequest,
  VisionCapabilities,
} from '../../shared/vision/types';

export interface VisionProvider {
  getCapabilities(): Promise<VisionCapabilities>;
  analyze(request: VisionAnalysisRequest): Promise<VisionAnalysis>;
  cancel(requestId: string): Promise<void>;
}
