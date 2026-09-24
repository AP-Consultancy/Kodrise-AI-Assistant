import type { SafeErrorPayload } from '../errors';
import type { PublicConfig } from '../config/types';
import type { SessionSnapshot, SessionState } from '../session/types';
import type {
  AudioCaptureStatus,
  AudioChunkDto,
  AudioDeviceInfo,
  AudioStreamConfig,
  MicrophonePermissionStatus,
} from '../audio/types';
import type {
  TranscriptEvent,
  TranscriptSegment,
  TranscriptSnapshot,
  TranscriptStatus,
} from '../transcription/types';
import type { STTProviderStatus, SttConfigStatus } from '../stt/types';
import type {
  DetectedQuestion,
  QuestionEvent,
  QuestionPipelineStatus,
  QuestionStatusSnapshot,
} from '../questions/types';
import type {
  ContextEngineStatus,
  ContextEvent,
  ContextSnapshot,
} from '../context/types';
import type {
  AIConfigStatus,
  AIEvent,
  AIOrchestratorStatus,
  AIResponseState,
} from '../ai/types';
import type {
  CaptureCapabilities,
  CaptureHarnessSnapshot,
  CapturePlatformId,
  CapturePolicyApplyResult,
  CapturePolicyEvent,
  CapturePolicyId,
  CapturePolicyStatus,
} from '../capture-policy/types';
import type {
  VisualCaptureCapabilities,
  VisualCaptureSource,
  VisualContextSnapshot,
  VisualContextStatus,
  VisualEvent,
  VisualFrameReference,
  VisualSourceKind,
} from '../visual-context/types';
import type {
  VisualIntelligenceEvent,
  VisualIntelligenceStatus,
} from '../visual-intelligence/types';
import type {
  InterviewSessionContextPublic,
  InterviewStatus,
  SessionDocumentKind,
  SessionDocumentMeta,
} from '../interview/types';
import type { SimulationConfig, SimulationPublicStatus } from '../simulation/types';

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: SafeErrorPayload };

export interface AppVersionInfo {
  version: string;
}

export interface AppRuntimeInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  contextIsolation: true;
  nodeIntegration: false;
  sandbox: true;
  webSecurity: true;
  isPackaged: boolean;
}

export interface SystemStatus {
  status: 'ok';
  timestamp: string;
  version: string;
  ipc: 'connected';
}

export type CredentialStorageState = 'available' | 'unavailable';

export interface CredentialStatus {
  key: string;
  configured: boolean;
  storage: CredentialStorageState;
}

export type CheckStatus =
  | 'pass'
  | 'fail'
  | 'pending'
  | 'ready'
  | 'not_configured'
  | 'not_tested'
  | 'unavailable';

export interface FoundationCheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ClientSecurityReport {
  preloadAvailable: boolean;
  nodeRequirePresent: boolean;
  companyAiApiPresent: boolean;
}

export interface FoundationDiagnostics {
  checks: FoundationCheckItem[];
  runtime: AppRuntimeInfo;
  publicConfig: PublicConfig;
  session: SessionSnapshot;
  ipc: 'connected' | 'disconnected';
  credentialStorage: CredentialStorageState;
}

export interface AudioForceStopEvent {
  reason: 'stop' | 'session_stop' | 'error';
}

export interface CompanyAiApi {
  app: {
    getVersion: () => Promise<IpcResult<AppVersionInfo>>;
    getInfo: () => Promise<IpcResult<AppRuntimeInfo>>;
  };
  system: {
    getStatus: () => Promise<IpcResult<SystemStatus>>;
  };
  session: {
    start: () => Promise<IpcResult<SessionSnapshot>>;
    stop: () => Promise<IpcResult<SessionSnapshot>>;
    pause: () => Promise<IpcResult<SessionSnapshot>>;
    resume: () => Promise<IpcResult<SessionSnapshot>>;
    getStatus: () => Promise<IpcResult<SessionSnapshot>>;
    onStatusChanged: (listener: (snapshot: SessionSnapshot) => void) => () => void;
  };
  config: {
    getPublic: () => Promise<IpcResult<PublicConfig>>;
    update: (patch: Partial<PublicConfig>) => Promise<IpcResult<PublicConfig>>;
  };
  credentials: {
    has: (key: string) => Promise<IpcResult<CredentialStatus>>;
    set: (key: string, value: string) => Promise<IpcResult<CredentialStatus>>;
    delete: (key: string) => Promise<IpcResult<CredentialStatus>>;
  };
  foundation: {
    getDiagnostics: (client?: ClientSecurityReport) => Promise<IpcResult<FoundationDiagnostics>>;
  };
  audio: {
    getDevices: () => Promise<IpcResult<AudioDeviceInfo[]>>;
    setDevices: (devices: AudioDeviceInfo[]) => Promise<IpcResult<AudioDeviceInfo[]>>;
    selectDevice: (deviceId: string | null) => Promise<IpcResult<AudioCaptureStatus>>;
    beginPermissionRequest: () => Promise<IpcResult<AudioCaptureStatus>>;
    setPermission: (permission: MicrophonePermissionStatus) => Promise<IpcResult<AudioCaptureStatus>>;
    getStatus: () => Promise<IpcResult<AudioCaptureStatus>>;
    start: (config?: Partial<AudioStreamConfig>) => Promise<IpcResult<AudioCaptureStatus>>;
    confirmActive: () => Promise<IpcResult<AudioCaptureStatus>>;
    pause: () => Promise<IpcResult<AudioCaptureStatus>>;
    resume: () => Promise<IpcResult<AudioCaptureStatus>>;
    stop: () => Promise<IpcResult<AudioCaptureStatus>>;
    pushChunk: (chunk: AudioChunkDto) => Promise<IpcResult<{ accepted: true }>>;
    reportCaptureError: (message: string) => Promise<IpcResult<AudioCaptureStatus>>;
    onStatusChanged: (listener: (status: AudioCaptureStatus) => void) => () => void;
    onForceStop: (listener: (event: AudioForceStopEvent) => void) => () => void;
  };
  audioInput: {
    getStatus: () => Promise<IpcResult<import('../audio-input/types').AudioInputStatus>>;
    getCapability: (
      mode?: import('../audio-input/types').AudioInputMode,
    ) => Promise<IpcResult<import('../audio-input/types').AudioInputCapability>>;
    getDiagnostics: () => Promise<IpcResult<import('../audio-input/types').AudioInputDiagnostics>>;
    enumerateDevices: () => Promise<IpcResult<import('../audio-input/types').AudioInputDevice[]>>;
    setMode: (
      mode: import('../audio-input/types').AudioInputMode,
    ) => Promise<IpcResult<import('../audio-input/types').AudioInputStatus>>;
    selectDevice: (
      role: 'microphone' | 'meeting_audio',
      deviceId: string | null,
    ) => Promise<IpcResult<import('../audio-input/types').AudioInputStatus>>;
    acknowledgeConsent: () => Promise<IpcResult<import('../audio-input/types').AudioInputStatus>>;
    markSourceActive: (
      source: 'microphone' | 'meeting_audio',
    ) => Promise<IpcResult<import('../audio-input/types').AudioInputStatus>>;
  };
  transcript: {
    getRecent: (limit?: number) => Promise<IpcResult<TranscriptSegment[]>>;
    getSnapshot: () => Promise<IpcResult<TranscriptSnapshot>>;
    clear: () => Promise<IpcResult<TranscriptSnapshot>>;
    getStatus: () => Promise<IpcResult<TranscriptStatus>>;
    onPartial: (listener: (event: TranscriptEvent) => void) => () => void;
    onFinal: (listener: (event: TranscriptEvent) => void) => () => void;
    onError: (listener: (event: TranscriptEvent) => void) => () => void;
  };
  stt: {
    getStatus: () => Promise<IpcResult<STTProviderStatus>>;
    getConfigStatus: () => Promise<IpcResult<SttConfigStatus>>;
    onStatusChanged: (listener: (status: STTProviderStatus) => void) => () => void;
  };
  questions: {
    getRecent: (limit?: number) => Promise<IpcResult<DetectedQuestion[]>>;
    getCurrent: () => Promise<IpcResult<DetectedQuestion | null>>;
    clear: () => Promise<IpcResult<QuestionStatusSnapshot>>;
    getStatus: () => Promise<IpcResult<QuestionPipelineStatus>>;
    onDetected: (listener: (event: QuestionEvent) => void) => () => void;
    onClassified: (listener: (event: QuestionEvent) => void) => () => void;
    onUpdated: (listener: (event: QuestionEvent) => void) => () => void;
  };
  context: {
    getCurrent: () => Promise<IpcResult<ContextSnapshot | null>>;
    getRecent: (limit?: number) => Promise<IpcResult<ContextSnapshot[]>>;
    clear: () => Promise<IpcResult<ContextEngineStatus>>;
    getStatus: () => Promise<IpcResult<ContextEngineStatus>>;
    onCreated: (listener: (event: ContextEvent) => void) => () => void;
    onUpdated: (listener: (event: ContextEvent) => void) => () => void;
    onTruncated: (listener: (event: ContextEvent) => void) => () => void;
  };
  ai: {
    getStatus: () => Promise<IpcResult<AIOrchestratorStatus>>;
    getConfiguration: () => Promise<IpcResult<AIConfigStatus>>;
    generate: (questionId: string) => Promise<IpcResult<AIResponseState>>;
    cancel: (requestId?: string) => Promise<IpcResult<AIResponseState | null>>;
    getCurrentResponse: () => Promise<IpcResult<AIResponseState | null>>;
    clearResponse: () => Promise<IpcResult<AIOrchestratorStatus>>;
    onRequestStarted: (listener: (event: AIEvent) => void) => () => void;
    onResponseStarted: (listener: (event: AIEvent) => void) => () => void;
    onResponseChunk: (listener: (event: AIEvent) => void) => () => void;
    onResponseCompleted: (listener: (event: AIEvent) => void) => () => void;
    onResponseCancelled: (listener: (event: AIEvent) => void) => () => void;
    onResponseError: (listener: (event: AIEvent) => void) => () => void;
  };
  capture: {
    getPlatform: () => Promise<IpcResult<CapturePlatformId>>;
    getCapabilities: () => Promise<IpcResult<CaptureCapabilities>>;
    getStatus: () => Promise<IpcResult<CapturePolicyStatus>>;
    getPolicy: () => Promise<IpcResult<CapturePolicyId>>;
    applyPolicy: (policy: CapturePolicyId) => Promise<IpcResult<CapturePolicyApplyResult>>;
    resetPolicy: () => Promise<IpcResult<CapturePolicyApplyResult>>;
    getHarness: () => Promise<IpcResult<CaptureHarnessSnapshot>>;
    onPolicyChanged: (listener: (event: CapturePolicyEvent) => void) => () => void;
    onCapabilityChanged: (listener: (event: CapturePolicyEvent) => void) => () => void;
    onDiagnosticUpdated: (listener: (event: CapturePolicyEvent) => void) => () => void;
  };
  visual: {
    getCapabilities: () => Promise<IpcResult<VisualCaptureCapabilities>>;
    listSources: () => Promise<IpcResult<VisualCaptureSource[]>>;
    requestPermission: () => Promise<IpcResult<boolean>>;
    getStatus: () => Promise<IpcResult<VisualContextStatus>>;
    enable: () => Promise<IpcResult<VisualContextStatus>>;
    disable: () => Promise<IpcResult<VisualContextStatus>>;
    setSource: (
      source: VisualSourceKind,
      sourceId?: string | null,
    ) => Promise<IpcResult<VisualContextStatus>>;
    start: () => Promise<IpcResult<VisualContextStatus>>;
    stop: () => Promise<IpcResult<VisualContextStatus>>;
    pause: () => Promise<IpcResult<VisualContextStatus>>;
    resume: () => Promise<IpcResult<VisualContextStatus>>;
    captureNow: (payload?: {
      sourceKind?: VisualSourceKind;
      sourceId?: string;
      region?: { x: number; y: number; width: number; height: number };
    }) => Promise<IpcResult<VisualFrameReference>>;
    clear: () => Promise<IpcResult<VisualContextStatus>>;
    getSnapshot: () => Promise<IpcResult<VisualContextSnapshot>>;
    onStatusChanged: (listener: (event: VisualEvent) => void) => () => void;
    onFrameCaptured: (listener: (event: VisualEvent) => void) => () => void;
    onFrameRejected: (listener: (event: VisualEvent) => void) => () => void;
    onContextChanged: (listener: (event: VisualEvent) => void) => () => void;
  };
  visualIntelligence: {
    getCapabilities: () => Promise<
      IpcResult<{
        ocr: { available: string; providerName: string };
        vision: { available: string; providerName: string; model: string | null };
        enabled: boolean;
      }>
    >;
    getStatus: () => Promise<IpcResult<VisualIntelligenceStatus>>;
    analyzeCurrent: (force?: boolean) => Promise<
      IpcResult<{ skipped: boolean; skipReason?: string; frameId: string | null }>
    >;
    cancel: (requestId?: string) => Promise<IpcResult<VisualIntelligenceStatus>>;
    clearResults: () => Promise<IpcResult<VisualIntelligenceStatus>>;
    onOcrStarted: (listener: (event: VisualIntelligenceEvent) => void) => () => void;
    onOcrCompleted: (listener: (event: VisualIntelligenceEvent) => void) => () => void;
    onOcrFailed: (listener: (event: VisualIntelligenceEvent) => void) => () => void;
    onVisionStarted: (listener: (event: VisualIntelligenceEvent) => void) => () => void;
    onVisionCompleted: (listener: (event: VisualIntelligenceEvent) => void) => () => void;
    onVisionFailed: (listener: (event: VisualIntelligenceEvent) => void) => () => void;
    onUpdated: (listener: (event: VisualIntelligenceEvent) => void) => () => void;
  };
  interview: {
    getStatus: () => Promise<IpcResult<InterviewStatus>>;
    getDocuments: () => Promise<IpcResult<InterviewSessionContextPublic>>;
    pickDocument: (kind: SessionDocumentKind) => Promise<IpcResult<SessionDocumentMeta>>;
    removeDocument: (id: string) => Promise<IpcResult<InterviewSessionContextPublic>>;
    start: () => Promise<IpcResult<InterviewStatus>>;
    markListening: () => Promise<IpcResult<InterviewStatus>>;
    pause: () => Promise<IpcResult<InterviewStatus>>;
    resume: () => Promise<IpcResult<InterviewStatus>>;
    end: () => Promise<IpcResult<InterviewStatus>>;
    newInterview: () => Promise<IpcResult<InterviewStatus>>;
    submitQuestion: (text: string) => Promise<IpcResult<InterviewStatus>>;
    regenerate: () => Promise<IpcResult<InterviewStatus>>;
    onStatusChanged: (listener: (status: InterviewStatus) => void) => () => void;
  };
  simulation: {
    getStatus: () => Promise<IpcResult<SimulationPublicStatus>>;
    start: () => Promise<IpcResult<SimulationPublicStatus>>;
    pause: () => Promise<IpcResult<SimulationPublicStatus>>;
    resume: () => Promise<IpcResult<SimulationPublicStatus>>;
    next: () => Promise<IpcResult<SimulationPublicStatus>>;
    restart: () => Promise<IpcResult<SimulationPublicStatus>>;
    end: () => Promise<IpcResult<SimulationPublicStatus>>;
    updateConfig: (patch: Partial<SimulationConfig>) => Promise<IpcResult<SimulationPublicStatus>>;
    onStatusChanged: (listener: (status: SimulationPublicStatus) => void) => () => void;
  };
}

declare global {
  interface Window {
    companyAI: CompanyAiApi;
  }
}

export type { SessionState, SessionSnapshot, PublicConfig };
