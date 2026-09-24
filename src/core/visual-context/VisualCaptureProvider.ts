import type {
  VisualCaptureCapabilities,
  VisualCaptureRequest,
  VisualCaptureSource,
  VisualFrame,
} from '../../shared/visual-context/types';

export interface VisualCaptureProvider {
  getCapabilities(): Promise<VisualCaptureCapabilities>;
  listSources(): Promise<VisualCaptureSource[]>;
  requestPermission(): Promise<boolean>;
  capture(request: VisualCaptureRequest): Promise<VisualFrame>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
