import type { ContextPublicConfig } from '../context/types';
import { DEFAULT_CONTEXT_PUBLIC_CONFIG } from '../context/types';
import type { AIPublicConfig } from '../ai/types';
import { DEFAULT_AI_PUBLIC_CONFIG } from '../ai/types';
import type { CapturePolicyId } from '../capture-policy/types';
import { DEFAULT_CAPTURE_POLICY } from '../capture-policy/types';
import type { VisualPublicConfig } from '../visual-context/types';
import { DEFAULT_VISUAL_PUBLIC_CONFIG } from '../visual-context/types';
import type { VisualIntelligencePublicConfig } from '../visual-intelligence/types';
import { DEFAULT_VISUAL_INTELLIGENCE_CONFIG } from '../visual-intelligence/types';

export type { ContextPublicConfig, UserContext, ProjectContext, ContextBudget } from '../context/types';
export type { AIPublicConfig, ResponseMode } from '../ai/types';
export { AI_OPENAI_CREDENTIAL_KEY, DEFAULT_AI_PUBLIC_CONFIG } from '../ai/types';
export type { CapturePolicyId } from '../capture-policy/types';
export type { VisualPublicConfig } from '../visual-context/types';
export { DEFAULT_VISUAL_PUBLIC_CONFIG } from '../visual-context/types';
export type { VisualIntelligencePublicConfig } from '../visual-intelligence/types';
export { DEFAULT_VISUAL_INTELLIGENCE_CONFIG } from '../visual-intelligence/types';

export type AiProviderId = 'none' | 'company-gateway' | 'local';

export type CaptureModePreference = 'off' | 'screen' | 'audio' | 'screen_and_audio';

export type SttProviderId = 'deepgram' | 'mock';

export interface FeatureFlags {
  enableSessionDiagnostics: boolean;
  enableExperimentalUi: boolean;
}

export interface CapturePreferences {
  /** Preference only — screen capture acquisition is not implemented in Phase 2F. */
  preferredMode: CaptureModePreference;
  requireExplicitConsent: true;
  showCaptureStatusBanner: true;
  /** Window OS/Electron capture-protection policy (non-secret). */
  windowPrivacyPolicy: CapturePolicyId;
}

export interface RetentionSettings {
  historyRetentionDays: number;
  logRetentionDays: number;
}

/** Non-secret STT settings. API keys live in CredentialVault only. */
export interface SttPublicConfig {
  provider: SttProviderId;
  model: string;
  language: string;
  sampleRate: number;
  channels: number;
  interimResults: boolean;
  endpoint: string;
}

export interface PublicConfig {
  schemaVersion: 1;
  theme: 'system' | 'light' | 'dark';
  language: string;
  selectedProviderId: AiProviderId;
  selectedModelId: string;
  featureFlags: FeatureFlags;
  capture: CapturePreferences;
  retention: RetentionSettings;
  stt: SttPublicConfig;
  context: ContextPublicConfig;
  ai: AIPublicConfig;
  visualContext: VisualPublicConfig;
  visualIntelligence: VisualIntelligencePublicConfig;
}

/** Secrets are never persisted in ordinary public JSON config. */
export interface SecretConfigRef {
  knownCredentialKeys: string[];
}

export const DEFAULT_STT_PUBLIC_CONFIG: SttPublicConfig = {
  provider: 'deepgram',
  model: 'nova-3',
  language: 'en',
  sampleRate: 16000,
  channels: 1,
  interimResults: true,
  endpoint: 'wss://api.deepgram.com/v1/listen',
};

export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  schemaVersion: 1,
  theme: 'system',
  language: 'en-US',
  selectedProviderId: 'none',
  selectedModelId: 'unset',
  featureFlags: {
    enableSessionDiagnostics: true,
    enableExperimentalUi: false,
  },
  capture: {
    preferredMode: 'off',
    requireExplicitConsent: true,
    showCaptureStatusBanner: true,
    windowPrivacyPolicy: DEFAULT_CAPTURE_POLICY,
  },
  retention: {
    historyRetentionDays: 30,
    logRetentionDays: 14,
  },
  stt: { ...DEFAULT_STT_PUBLIC_CONFIG },
  context: structuredClone(DEFAULT_CONTEXT_PUBLIC_CONFIG),
  ai: structuredClone(DEFAULT_AI_PUBLIC_CONFIG),
  visualContext: structuredClone(DEFAULT_VISUAL_PUBLIC_CONFIG),
  visualIntelligence: structuredClone(DEFAULT_VISUAL_INTELLIGENCE_CONFIG),
};

/** CredentialVault key for Deepgram API token. Never exposed to renderer. */
export const STT_DEEPGRAM_CREDENTIAL_KEY = 'stt.deepgram.apiKey';
