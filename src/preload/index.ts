import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels, IpcEvents } from '../shared/ipc/channels';
import type {
  AppRuntimeInfo,
  AppVersionInfo,
  AudioForceStopEvent,
  ClientSecurityReport,
  CompanyAiApi,
  CredentialStatus,
  FoundationDiagnostics,
  IpcResult,
  SystemStatus,
} from '../shared/ipc/types';
import type { PublicConfig } from '../shared/config/types';
import type { SessionSnapshot } from '../shared/session/types';
import type {
  AudioCaptureStatus,
  AudioChunkDto,
  AudioDeviceInfo,
  AudioStreamConfig,
  MicrophonePermissionStatus,
} from '../shared/audio/types';
import type {
  TranscriptSegment,
  TranscriptSnapshot,
  TranscriptStatus,
} from '../shared/transcription/types';
import type { STTProviderStatus, SttConfigStatus } from '../shared/stt/types';
import type {
  DetectedQuestion,
  QuestionPipelineStatus,
  QuestionStatusSnapshot,
} from '../shared/questions/types';
import type {
  ContextEngineStatus,
  ContextSnapshot,
} from '../shared/context/types';
import type {
  AIConfigStatus,
  AIOrchestratorStatus,
  AIResponseState,
} from '../shared/ai/types';
import type {
  CaptureCapabilities,
  CaptureHarnessSnapshot,
  CapturePlatformId,
  CapturePolicyApplyResult,
  CapturePolicyId,
  CapturePolicyStatus,
} from '../shared/capture-policy/types';
import type {
  VisualCaptureCapabilities,
  VisualCaptureSource,
  VisualContextSnapshot,
  VisualContextStatus,
  VisualFrameReference,
  VisualSourceKind,
} from '../shared/visual-context/types';
import type {
  VisualIntelligenceEvent,
  VisualIntelligenceStatus,
} from '../shared/visual-intelligence/types';
import type {
  InterviewSessionContextPublic,
  InterviewStatus,
  SessionDocumentKind,
  SessionDocumentMeta,
} from '../shared/interview/types';
import type { SimulationConfig, SimulationPublicStatus } from '../shared/simulation/types';

function onEvent<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T) => {
    listener(payload);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: CompanyAiApi = {
  app: {
    getVersion: (): Promise<IpcResult<AppVersionInfo>> =>
      ipcRenderer.invoke(IpcChannels.APP_GET_VERSION),
    getInfo: (): Promise<IpcResult<AppRuntimeInfo>> => ipcRenderer.invoke(IpcChannels.APP_GET_INFO),
  },
  system: {
    getStatus: (): Promise<IpcResult<SystemStatus>> =>
      ipcRenderer.invoke(IpcChannels.SYSTEM_GET_STATUS),
  },
  session: {
    start: (): Promise<IpcResult<SessionSnapshot>> => ipcRenderer.invoke(IpcChannels.SESSION_START),
    stop: (): Promise<IpcResult<SessionSnapshot>> => ipcRenderer.invoke(IpcChannels.SESSION_STOP),
    pause: (): Promise<IpcResult<SessionSnapshot>> => ipcRenderer.invoke(IpcChannels.SESSION_PAUSE),
    resume: (): Promise<IpcResult<SessionSnapshot>> =>
      ipcRenderer.invoke(IpcChannels.SESSION_RESUME),
    getStatus: (): Promise<IpcResult<SessionSnapshot>> =>
      ipcRenderer.invoke(IpcChannels.SESSION_GET_STATUS),
    onStatusChanged: (listener) => onEvent(IpcEvents.SESSION_STATUS_CHANGED, listener),
  },
  config: {
    getPublic: (): Promise<IpcResult<PublicConfig>> =>
      ipcRenderer.invoke(IpcChannels.CONFIG_GET_PUBLIC),
    update: (patch: Partial<PublicConfig>): Promise<IpcResult<PublicConfig>> =>
      ipcRenderer.invoke(IpcChannels.CONFIG_UPDATE, patch),
  },
  credentials: {
    has: (key: string): Promise<IpcResult<CredentialStatus>> =>
      ipcRenderer.invoke(IpcChannels.CREDENTIALS_HAS, { key }),
    set: (key: string, value: string): Promise<IpcResult<CredentialStatus>> =>
      ipcRenderer.invoke(IpcChannels.CREDENTIALS_SET, { key, value }),
    delete: (key: string): Promise<IpcResult<CredentialStatus>> =>
      ipcRenderer.invoke(IpcChannels.CREDENTIALS_DELETE, { key }),
  },
  foundation: {
    getDiagnostics: (client?: ClientSecurityReport): Promise<IpcResult<FoundationDiagnostics>> =>
      ipcRenderer.invoke(IpcChannels.FOUNDATION_GET_DIAGNOSTICS, client),
  },
  audio: {
    getDevices: (): Promise<IpcResult<AudioDeviceInfo[]>> =>
      ipcRenderer.invoke(IpcChannels.AUDIO_GET_DEVICES),
    setDevices: (devices: AudioDeviceInfo[]): Promise<IpcResult<AudioDeviceInfo[]>> =>
      ipcRenderer.invoke(IpcChannels.AUDIO_SET_DEVICES, { devices }),
    selectDevice: (deviceId: string | null): Promise<IpcResult<AudioCaptureStatus>> =>
      ipcRenderer.invoke(IpcChannels.AUDIO_SELECT_DEVICE, { deviceId }),
    beginPermissionRequest: (): Promise<IpcResult<AudioCaptureStatus>> =>
      ipcRenderer.invoke(IpcChannels.AUDIO_BEGIN_PERMISSION),
    setPermission: (
      permission: MicrophonePermissionStatus,
    ): Promise<IpcResult<AudioCaptureStatus>> =>
      ipcRenderer.invoke(IpcChannels.AUDIO_SET_PERMISSION, { permission }),
    getStatus: (): Promise<IpcResult<AudioCaptureStatus>> =>
      ipcRenderer.invoke(IpcChannels.AUDIO_GET_STATUS),
    start: (config?: Partial<AudioStreamConfig>): Promise<IpcResult<AudioCaptureStatus>> =>
      ipcRenderer.invoke(IpcChannels.AUDIO_START, config ?? {}),
    confirmActive: (): Promise<IpcResult<AudioCaptureStatus>> =>
      ipcRenderer.invoke(IpcChannels.AUDIO_CONFIRM_ACTIVE),
    pause: (): Promise<IpcResult<AudioCaptureStatus>> => ipcRenderer.invoke(IpcChannels.AUDIO_PAUSE),
    resume: (): Promise<IpcResult<AudioCaptureStatus>> =>
      ipcRenderer.invoke(IpcChannels.AUDIO_RESUME),
    stop: (): Promise<IpcResult<AudioCaptureStatus>> => ipcRenderer.invoke(IpcChannels.AUDIO_STOP),
    pushChunk: (chunk: AudioChunkDto): Promise<IpcResult<{ accepted: true }>> =>
      ipcRenderer.invoke(IpcChannels.AUDIO_PUSH_CHUNK, chunk),
    reportCaptureError: (message: string): Promise<IpcResult<AudioCaptureStatus>> =>
      ipcRenderer.invoke(IpcChannels.AUDIO_CAPTURE_ERROR, { message }),
    onStatusChanged: (listener) => onEvent(IpcEvents.AUDIO_STATUS_CHANGED, listener),
    onForceStop: (listener: (event: AudioForceStopEvent) => void) =>
      onEvent(IpcEvents.AUDIO_FORCE_STOP, listener),
  },
  audioInput: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.AUDIO_INPUT_GET_STATUS),
    getCapability: (mode?: string) =>
      ipcRenderer.invoke(IpcChannels.AUDIO_INPUT_GET_CAPABILITY, mode ? { mode } : {}),
    getDiagnostics: () => ipcRenderer.invoke(IpcChannels.AUDIO_INPUT_GET_DIAGNOSTICS),
    enumerateDevices: () => ipcRenderer.invoke(IpcChannels.AUDIO_INPUT_ENUMERATE),
    setMode: (mode: string) => ipcRenderer.invoke(IpcChannels.AUDIO_INPUT_SET_MODE, { mode }),
    selectDevice: (role: 'microphone' | 'meeting_audio', deviceId: string | null) =>
      ipcRenderer.invoke(IpcChannels.AUDIO_INPUT_SELECT_DEVICE, { role, deviceId }),
    acknowledgeConsent: () => ipcRenderer.invoke(IpcChannels.AUDIO_INPUT_ACK_CONSENT),
    markSourceActive: (source: 'microphone' | 'meeting_audio') =>
      ipcRenderer.invoke(IpcChannels.AUDIO_INPUT_MARK_SOURCE_ACTIVE, { source }),
  },
  transcript: {
    getRecent: (limit?: number): Promise<IpcResult<TranscriptSegment[]>> =>
      ipcRenderer.invoke(IpcChannels.TRANSCRIPT_GET_RECENT, limit ? { limit } : {}),
    getSnapshot: (): Promise<IpcResult<TranscriptSnapshot>> =>
      ipcRenderer.invoke(IpcChannels.TRANSCRIPT_GET_SNAPSHOT),
    clear: (): Promise<IpcResult<TranscriptSnapshot>> =>
      ipcRenderer.invoke(IpcChannels.TRANSCRIPT_CLEAR),
    getStatus: (): Promise<IpcResult<TranscriptStatus>> =>
      ipcRenderer.invoke(IpcChannels.TRANSCRIPT_GET_STATUS),
    onPartial: (listener) => onEvent(IpcEvents.TRANSCRIPT_PARTIAL, listener),
    onFinal: (listener) => onEvent(IpcEvents.TRANSCRIPT_FINAL, listener),
    onError: (listener) => onEvent(IpcEvents.TRANSCRIPT_ERROR, listener),
  },
  stt: {
    getStatus: (): Promise<IpcResult<STTProviderStatus>> =>
      ipcRenderer.invoke(IpcChannels.STT_GET_STATUS),
    getConfigStatus: (): Promise<IpcResult<SttConfigStatus>> =>
      ipcRenderer.invoke(IpcChannels.STT_GET_CONFIG_STATUS),
    onStatusChanged: (listener) => onEvent(IpcEvents.STT_STATUS_CHANGED, listener),
  },
  questions: {
    getRecent: (limit?: number): Promise<IpcResult<DetectedQuestion[]>> =>
      ipcRenderer.invoke(IpcChannels.QUESTION_GET_RECENT, limit ? { limit } : {}),
    getCurrent: (): Promise<IpcResult<DetectedQuestion | null>> =>
      ipcRenderer.invoke(IpcChannels.QUESTION_GET_CURRENT),
    clear: (): Promise<IpcResult<QuestionStatusSnapshot>> =>
      ipcRenderer.invoke(IpcChannels.QUESTION_CLEAR),
    getStatus: (): Promise<IpcResult<QuestionPipelineStatus>> =>
      ipcRenderer.invoke(IpcChannels.QUESTION_GET_STATUS),
    onDetected: (listener) => onEvent(IpcEvents.QUESTION_DETECTED, listener),
    onClassified: (listener) => onEvent(IpcEvents.QUESTION_CLASSIFIED, listener),
    onUpdated: (listener) => onEvent(IpcEvents.QUESTION_UPDATED, listener),
  },
  context: {
    getCurrent: (): Promise<IpcResult<ContextSnapshot | null>> =>
      ipcRenderer.invoke(IpcChannels.CONTEXT_GET_CURRENT),
    getRecent: (limit?: number): Promise<IpcResult<ContextSnapshot[]>> =>
      ipcRenderer.invoke(IpcChannels.CONTEXT_GET_RECENT, limit ? { limit } : {}),
    clear: (): Promise<IpcResult<ContextEngineStatus>> =>
      ipcRenderer.invoke(IpcChannels.CONTEXT_CLEAR),
    getStatus: (): Promise<IpcResult<ContextEngineStatus>> =>
      ipcRenderer.invoke(IpcChannels.CONTEXT_GET_STATUS),
    onCreated: (listener) => onEvent(IpcEvents.CONTEXT_CREATED, listener),
    onUpdated: (listener) => onEvent(IpcEvents.CONTEXT_UPDATED, listener),
    onTruncated: (listener) => onEvent(IpcEvents.CONTEXT_TRUNCATED, listener),
  },
  ai: {
    getStatus: (): Promise<IpcResult<AIOrchestratorStatus>> =>
      ipcRenderer.invoke(IpcChannels.AI_GET_STATUS),
    getConfiguration: (): Promise<IpcResult<AIConfigStatus>> =>
      ipcRenderer.invoke(IpcChannels.AI_GET_CONFIGURATION),
    generate: (questionId: string): Promise<IpcResult<AIResponseState>> =>
      ipcRenderer.invoke(IpcChannels.AI_GENERATE, { questionId }),
    cancel: (requestId?: string): Promise<IpcResult<AIResponseState | null>> =>
      ipcRenderer.invoke(IpcChannels.AI_CANCEL, requestId ? { requestId } : {}),
    getCurrentResponse: (): Promise<IpcResult<AIResponseState | null>> =>
      ipcRenderer.invoke(IpcChannels.AI_GET_CURRENT_RESPONSE),
    clearResponse: (): Promise<IpcResult<AIOrchestratorStatus>> =>
      ipcRenderer.invoke(IpcChannels.AI_CLEAR_RESPONSE),
    onRequestStarted: (listener) => onEvent(IpcEvents.AI_REQUEST_STARTED, listener),
    onResponseStarted: (listener) => onEvent(IpcEvents.AI_RESPONSE_STARTED, listener),
    onResponseChunk: (listener) => onEvent(IpcEvents.AI_RESPONSE_CHUNK, listener),
    onResponseCompleted: (listener) => onEvent(IpcEvents.AI_RESPONSE_COMPLETED, listener),
    onResponseCancelled: (listener) => onEvent(IpcEvents.AI_RESPONSE_CANCELLED, listener),
    onResponseError: (listener) => onEvent(IpcEvents.AI_RESPONSE_ERROR, listener),
  },
  capture: {
    getPlatform: (): Promise<IpcResult<CapturePlatformId>> =>
      ipcRenderer.invoke(IpcChannels.CAPTURE_GET_PLATFORM),
    getCapabilities: (): Promise<IpcResult<CaptureCapabilities>> =>
      ipcRenderer.invoke(IpcChannels.CAPTURE_GET_CAPABILITIES),
    getStatus: (): Promise<IpcResult<CapturePolicyStatus>> =>
      ipcRenderer.invoke(IpcChannels.CAPTURE_GET_STATUS),
    getPolicy: (): Promise<IpcResult<CapturePolicyId>> =>
      ipcRenderer.invoke(IpcChannels.CAPTURE_GET_POLICY),
    applyPolicy: (policy: CapturePolicyId): Promise<IpcResult<CapturePolicyApplyResult>> =>
      ipcRenderer.invoke(IpcChannels.CAPTURE_APPLY_POLICY, { policy }),
    resetPolicy: (): Promise<IpcResult<CapturePolicyApplyResult>> =>
      ipcRenderer.invoke(IpcChannels.CAPTURE_RESET_POLICY),
    getHarness: (): Promise<IpcResult<CaptureHarnessSnapshot>> =>
      ipcRenderer.invoke(IpcChannels.CAPTURE_GET_HARNESS),
    onPolicyChanged: (listener) => onEvent(IpcEvents.CAPTURE_POLICY_CHANGED, listener),
    onCapabilityChanged: (listener) => onEvent(IpcEvents.CAPTURE_CAPABILITY_CHANGED, listener),
    onDiagnosticUpdated: (listener) => onEvent(IpcEvents.CAPTURE_DIAGNOSTIC_UPDATED, listener),
  },
  visual: {
    getCapabilities: (): Promise<IpcResult<VisualCaptureCapabilities>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_GET_CAPABILITIES),
    listSources: (): Promise<IpcResult<VisualCaptureSource[]>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_LIST_SOURCES),
    requestPermission: (): Promise<IpcResult<boolean>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_REQUEST_PERMISSION),
    getStatus: (): Promise<IpcResult<VisualContextStatus>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_GET_STATUS),
    enable: (): Promise<IpcResult<VisualContextStatus>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_ENABLE),
    disable: (): Promise<IpcResult<VisualContextStatus>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_DISABLE),
    setSource: (
      source: VisualSourceKind,
      sourceId?: string | null,
    ): Promise<IpcResult<VisualContextStatus>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_SET_SOURCE, { source, sourceId }),
    start: (): Promise<IpcResult<VisualContextStatus>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_START),
    stop: (): Promise<IpcResult<VisualContextStatus>> => ipcRenderer.invoke(IpcChannels.VISUAL_STOP),
    pause: (): Promise<IpcResult<VisualContextStatus>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_PAUSE),
    resume: (): Promise<IpcResult<VisualContextStatus>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_RESUME),
    captureNow: (payload?: {
      sourceKind?: VisualSourceKind;
      sourceId?: string;
      region?: { x: number; y: number; width: number; height: number };
    }): Promise<IpcResult<VisualFrameReference>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_CAPTURE_NOW, payload ?? {}),
    clear: (): Promise<IpcResult<VisualContextStatus>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_CLEAR),
    getSnapshot: (): Promise<IpcResult<VisualContextSnapshot>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_GET_SNAPSHOT),
    onStatusChanged: (listener) => onEvent(IpcEvents.VISUAL_STATUS_CHANGED, listener),
    onFrameCaptured: (listener) => onEvent(IpcEvents.VISUAL_FRAME_CAPTURED, listener),
    onFrameRejected: (listener) => onEvent(IpcEvents.VISUAL_FRAME_REJECTED, listener),
    onContextChanged: (listener) => onEvent(IpcEvents.VISUAL_CONTEXT_CHANGED, listener),
  },
  visualIntelligence: {
    getCapabilities: () => ipcRenderer.invoke(IpcChannels.VISUAL_INTELLIGENCE_GET_CAPABILITIES),
    getStatus: (): Promise<IpcResult<VisualIntelligenceStatus>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_INTELLIGENCE_GET_STATUS),
    analyzeCurrent: (force?: boolean) =>
      ipcRenderer.invoke(IpcChannels.VISUAL_INTELLIGENCE_ANALYZE_CURRENT, { force }),
    cancel: (requestId?: string) =>
      ipcRenderer.invoke(IpcChannels.VISUAL_INTELLIGENCE_CANCEL, { requestId }),
    clearResults: (): Promise<IpcResult<VisualIntelligenceStatus>> =>
      ipcRenderer.invoke(IpcChannels.VISUAL_INTELLIGENCE_CLEAR_RESULTS),
    onOcrStarted: (listener: (event: VisualIntelligenceEvent) => void) =>
      onEvent(IpcEvents.VISUAL_OCR_STARTED, listener),
    onOcrCompleted: (listener: (event: VisualIntelligenceEvent) => void) =>
      onEvent(IpcEvents.VISUAL_OCR_COMPLETED, listener),
    onOcrFailed: (listener: (event: VisualIntelligenceEvent) => void) =>
      onEvent(IpcEvents.VISUAL_OCR_FAILED, listener),
    onVisionStarted: (listener: (event: VisualIntelligenceEvent) => void) =>
      onEvent(IpcEvents.VISUAL_VISION_STARTED, listener),
    onVisionCompleted: (listener: (event: VisualIntelligenceEvent) => void) =>
      onEvent(IpcEvents.VISUAL_VISION_COMPLETED, listener),
    onVisionFailed: (listener: (event: VisualIntelligenceEvent) => void) =>
      onEvent(IpcEvents.VISUAL_VISION_FAILED, listener),
    onUpdated: (listener: (event: VisualIntelligenceEvent) => void) =>
      onEvent(IpcEvents.VISUAL_INTELLIGENCE_UPDATED, listener),
  },
  interview: {
    getStatus: (): Promise<IpcResult<InterviewStatus>> =>
      ipcRenderer.invoke(IpcChannels.INTERVIEW_GET_STATUS),
    getDocuments: (): Promise<IpcResult<InterviewSessionContextPublic>> =>
      ipcRenderer.invoke(IpcChannels.INTERVIEW_GET_DOCUMENTS),
    pickDocument: (kind: SessionDocumentKind): Promise<IpcResult<SessionDocumentMeta>> =>
      ipcRenderer.invoke(IpcChannels.INTERVIEW_PICK_DOCUMENT, { kind }),
    removeDocument: (id: string): Promise<IpcResult<InterviewSessionContextPublic>> =>
      ipcRenderer.invoke(IpcChannels.INTERVIEW_REMOVE_DOCUMENT, { id }),
    start: (): Promise<IpcResult<InterviewStatus>> =>
      ipcRenderer.invoke(IpcChannels.INTERVIEW_START),
    markListening: (): Promise<IpcResult<InterviewStatus>> =>
      ipcRenderer.invoke(IpcChannels.INTERVIEW_MARK_LISTENING),
    pause: (): Promise<IpcResult<InterviewStatus>> =>
      ipcRenderer.invoke(IpcChannels.INTERVIEW_PAUSE),
    resume: (): Promise<IpcResult<InterviewStatus>> =>
      ipcRenderer.invoke(IpcChannels.INTERVIEW_RESUME),
    end: (): Promise<IpcResult<InterviewStatus>> => ipcRenderer.invoke(IpcChannels.INTERVIEW_END),
    newInterview: (): Promise<IpcResult<InterviewStatus>> =>
      ipcRenderer.invoke(IpcChannels.INTERVIEW_NEW),
    submitQuestion: (text: string): Promise<IpcResult<InterviewStatus>> =>
      ipcRenderer.invoke(IpcChannels.INTERVIEW_SUBMIT_QUESTION, { text }),
    regenerate: (): Promise<IpcResult<InterviewStatus>> =>
      ipcRenderer.invoke(IpcChannels.INTERVIEW_REGENERATE),
    onStatusChanged: (listener: (status: InterviewStatus) => void) =>
      onEvent(IpcEvents.INTERVIEW_STATUS_CHANGED, listener),
  },
  simulation: {
    getStatus: (): Promise<IpcResult<SimulationPublicStatus>> =>
      ipcRenderer.invoke(IpcChannels.SIMULATION_GET_STATUS),
    start: (): Promise<IpcResult<SimulationPublicStatus>> =>
      ipcRenderer.invoke(IpcChannels.SIMULATION_START),
    pause: (): Promise<IpcResult<SimulationPublicStatus>> =>
      ipcRenderer.invoke(IpcChannels.SIMULATION_PAUSE),
    resume: (): Promise<IpcResult<SimulationPublicStatus>> =>
      ipcRenderer.invoke(IpcChannels.SIMULATION_RESUME),
    next: (): Promise<IpcResult<SimulationPublicStatus>> =>
      ipcRenderer.invoke(IpcChannels.SIMULATION_NEXT),
    restart: (): Promise<IpcResult<SimulationPublicStatus>> =>
      ipcRenderer.invoke(IpcChannels.SIMULATION_RESTART),
    end: (): Promise<IpcResult<SimulationPublicStatus>> =>
      ipcRenderer.invoke(IpcChannels.SIMULATION_END),
    updateConfig: (patch: Partial<SimulationConfig>): Promise<IpcResult<SimulationPublicStatus>> =>
      ipcRenderer.invoke(IpcChannels.SIMULATION_UPDATE_CONFIG, patch),
    onStatusChanged: (listener: (status: SimulationPublicStatus) => void) =>
      onEvent(IpcEvents.SIMULATION_STATUS_CHANGED, listener),
  },
};

contextBridge.exposeInMainWorld('companyAI', api);
