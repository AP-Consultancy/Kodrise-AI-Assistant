import { z } from 'zod';
import {
  DEFAULT_PUBLIC_CONFIG,
  DEFAULT_STT_PUBLIC_CONFIG,
  DEFAULT_AUDIO_INPUT_PUBLIC_CONFIG,
} from '../../shared/config/types';
import { DEFAULT_CONTEXT_PUBLIC_CONFIG } from '../../shared/context/types';
import { DEFAULT_AI_PUBLIC_CONFIG } from '../../shared/ai/types';
import { DEFAULT_VISUAL_PUBLIC_CONFIG } from '../../shared/visual-context/types';
import { DEFAULT_VISUAL_INTELLIGENCE_CONFIG } from '../../shared/visual-intelligence/types';

export const FeatureFlagsSchema = z
  .object({
    enableSessionDiagnostics: z.boolean(),
    enableExperimentalUi: z.boolean(),
  })
  .strict();

export const CapturePreferencesSchema = z
  .object({
    preferredMode: z.enum(['off', 'screen', 'audio', 'screen_and_audio']),
    requireExplicitConsent: z.literal(true),
    showCaptureStatusBanner: z.literal(true),
    windowPrivacyPolicy: z.enum(['STANDARD', 'PRIVACY_AWARE', 'DISABLED']),
  })
  .strict();

export const RetentionSettingsSchema = z
  .object({
    historyRetentionDays: z.number().int().min(0).max(3650),
    logRetentionDays: z.number().int().min(0).max(3650),
  })
  .strict();

export const SttPublicConfigSchema = z
  .object({
    provider: z.enum(['deepgram', 'mock']),
    model: z.string().min(1).max(128),
    language: z.string().min(2).max(32),
    sampleRate: z.number().int().min(8000).max(48000),
    channels: z.number().int().min(1).max(2),
    interimResults: z.boolean(),
    endpoint: z
      .string()
      .url()
      .refine((value) => value.startsWith('wss://') || value.startsWith('ws://'), {
        message: 'STT endpoint must be a WebSocket URL',
      }),
  })
  .strict();

export const AudioInputPublicConfigSchema = z
  .object({
    inputMode: z.enum(['microphone', 'meeting_audio', 'microphone_and_meeting']),
    microphoneDeviceId: z.string().min(1).max(256).nullable(),
    meetingAudioDeviceId: z.string().min(1).max(256).nullable(),
  })
  .strict();

export const ContextBudgetSchema = z
  .object({
    maxTranscriptSegments: z.number().int().min(1).max(100),
    maxTranscriptCharacters: z.number().int().min(100).max(50_000),
    maxQuestionCount: z.number().int().min(1).max(50),
    maxRelatedQuestions: z.number().int().min(0).max(20),
    maxContextCharacters: z.number().int().min(200).max(100_000),
    maxRecentSnapshots: z.number().int().min(1).max(100),
  })
  .strict();

export const UserContextSchema = z
  .object({
    name: z.string().max(120).optional(),
    role: z.string().max(120).optional(),
    experience: z.string().max(500).optional(),
    skills: z.array(z.string().max(64)).max(32).optional(),
    preferences: z.record(z.string(), z.string().max(256)).optional(),
  })
  .strict();

export const ProjectContextSchema = z
  .object({
    projectName: z.string().max(160).optional(),
    description: z.string().max(1200).optional(),
    technologies: z.array(z.string().max(64)).max(40).optional(),
    architecture: z.string().max(800).optional(),
    responsibilities: z.array(z.string().max(160)).max(40).optional(),
  })
  .strict();

export const ContextPublicConfigSchema = z
  .object({
    budget: ContextBudgetSchema,
    userContext: UserContextSchema,
    projectContext: ProjectContextSchema,
  })
  .strict();

export const AIPublicConfigSchema = z
  .object({
    provider: z.enum(['openai', 'mock']),
    model: z.string().min(1).max(128),
    responseMode: z.enum(['short', 'normal', 'detailed']),
    temperature: z.number().min(0).max(2),
    maxOutputTokens: z.number().int().min(16).max(8192),
    autoGenerate: z.boolean(),
    minClassificationConfidence: z.number().min(0).max(1),
    maxResponseHistory: z.number().int().min(1).max(100),
  })
  .strict();

export const VisualPublicConfigSchema = z
  .object({
    enabled: z.boolean(),
    source: z.enum(['DISPLAY', 'WINDOW', 'REGION', 'MANUAL_IMAGE', 'NONE']),
    maxFrames: z.number().int().min(1).max(20),
    maxImageBytes: z.number().int().min(10_000).max(10_000_000),
    maxWidth: z.number().int().min(64).max(3840),
    maxHeight: z.number().int().min(64).max(2160),
    captureIntervalMs: z.number().int().min(0).max(120_000),
    maxVisualContextBytes: z.number().int().min(50_000).max(20_000_000),
  })
  .strict();

export const VisualIntelligencePublicConfigSchema = z
  .object({
    enabled: z.boolean(),
    ocr: z
      .object({
        enabled: z.boolean(),
        provider: z.enum(['mock', 'openai']),
        maxCharacters: z.number().int().min(100).max(20_000),
      })
      .strict(),
    vision: z
      .object({
        enabled: z.boolean(),
        provider: z.enum(['mock', 'openai']),
        model: z.string().min(1).max(128),
      })
      .strict(),
    maxAnalysisFrames: z.number().int().min(1).max(10),
    analysisTimeoutMs: z.number().int().min(1000).max(180_000),
    autoAnalyzeOnCapture: z.boolean(),
    autoAnalyzeOnQuestion: z.boolean(),
  })
  .strict();

export const PublicConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    theme: z.enum(['system', 'light', 'dark']),
    language: z.string().min(2).max(32),
    selectedProviderId: z.enum(['none', 'company-gateway', 'local']),
    selectedModelId: z.string().min(1).max(128),
    featureFlags: FeatureFlagsSchema,
    capture: CapturePreferencesSchema,
    retention: RetentionSettingsSchema,
    stt: SttPublicConfigSchema,
    audioInput: AudioInputPublicConfigSchema,
    context: ContextPublicConfigSchema,
    ai: AIPublicConfigSchema,
    visualContext: VisualPublicConfigSchema,
    visualIntelligence: VisualIntelligencePublicConfigSchema,
  })
  .strict();

export const PublicConfigUpdateSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']).optional(),
    language: z.string().min(2).max(32).optional(),
    selectedProviderId: z.enum(['none', 'company-gateway', 'local']).optional(),
    selectedModelId: z.string().min(1).max(128).optional(),
    featureFlags: FeatureFlagsSchema.partial().optional(),
    capture: z
      .object({
        preferredMode: z.enum(['off', 'screen', 'audio', 'screen_and_audio']).optional(),
        requireExplicitConsent: z.literal(true).optional(),
        showCaptureStatusBanner: z.literal(true).optional(),
        windowPrivacyPolicy: z.enum(['STANDARD', 'PRIVACY_AWARE', 'DISABLED']).optional(),
      })
      .strict()
      .optional(),
    retention: RetentionSettingsSchema.partial().optional(),
    stt: SttPublicConfigSchema.partial().optional(),
    audioInput: AudioInputPublicConfigSchema.partial().optional(),
    context: z
      .object({
        budget: ContextBudgetSchema.partial().optional(),
        userContext: UserContextSchema.optional(),
        projectContext: ProjectContextSchema.optional(),
      })
      .strict()
      .optional(),
    ai: AIPublicConfigSchema.partial().optional(),
    visualContext: VisualPublicConfigSchema.partial().optional(),
    visualIntelligence: z
      .object({
        enabled: z.boolean().optional(),
        ocr: z
          .object({
            enabled: z.boolean().optional(),
            provider: z.enum(['mock', 'openai']).optional(),
            maxCharacters: z.number().int().min(100).max(20_000).optional(),
          })
          .strict()
          .optional(),
        vision: z
          .object({
            enabled: z.boolean().optional(),
            provider: z.enum(['mock', 'openai']).optional(),
            model: z.string().min(1).max(128).optional(),
          })
          .strict()
          .optional(),
        maxAnalysisFrames: z.number().int().min(1).max(10).optional(),
        analysisTimeoutMs: z.number().int().min(1000).max(180_000).optional(),
        autoAnalyzeOnCapture: z.boolean().optional(),
        autoAnalyzeOnQuestion: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

function mergeWithDefaults(input: unknown): unknown {
  if (!input || typeof input !== 'object') {
    return input;
  }
  const raw = input as Record<string, unknown>;
  const featureFlags =
    raw.featureFlags && typeof raw.featureFlags === 'object'
      ? { ...DEFAULT_PUBLIC_CONFIG.featureFlags, ...(raw.featureFlags as object) }
      : DEFAULT_PUBLIC_CONFIG.featureFlags;
  const capture =
    raw.capture && typeof raw.capture === 'object'
      ? {
          ...DEFAULT_PUBLIC_CONFIG.capture,
          ...(raw.capture as object),
          requireExplicitConsent: true as const,
          showCaptureStatusBanner: true as const,
          windowPrivacyPolicy:
            (raw.capture as { windowPrivacyPolicy?: string }).windowPrivacyPolicy ===
              'PRIVACY_AWARE' ||
            (raw.capture as { windowPrivacyPolicy?: string }).windowPrivacyPolicy === 'DISABLED' ||
            (raw.capture as { windowPrivacyPolicy?: string }).windowPrivacyPolicy === 'STANDARD'
              ? (raw.capture as { windowPrivacyPolicy: 'STANDARD' | 'PRIVACY_AWARE' | 'DISABLED' })
                  .windowPrivacyPolicy
              : DEFAULT_PUBLIC_CONFIG.capture.windowPrivacyPolicy,
        }
      : DEFAULT_PUBLIC_CONFIG.capture;
  const retention =
    raw.retention && typeof raw.retention === 'object'
      ? { ...DEFAULT_PUBLIC_CONFIG.retention, ...(raw.retention as object) }
      : DEFAULT_PUBLIC_CONFIG.retention;
  const stt =
    raw.stt && typeof raw.stt === 'object'
      ? { ...DEFAULT_STT_PUBLIC_CONFIG, ...(raw.stt as object) }
      : DEFAULT_STT_PUBLIC_CONFIG;
  const audioInput =
    raw.audioInput && typeof raw.audioInput === 'object'
      ? { ...DEFAULT_AUDIO_INPUT_PUBLIC_CONFIG, ...(raw.audioInput as object) }
      : DEFAULT_AUDIO_INPUT_PUBLIC_CONFIG;
  const rawContext =
    raw.context && typeof raw.context === 'object'
      ? (raw.context as Record<string, unknown>)
      : {};
  const context = {
    budget: {
      ...DEFAULT_CONTEXT_PUBLIC_CONFIG.budget,
      ...(rawContext.budget && typeof rawContext.budget === 'object'
        ? (rawContext.budget as object)
        : {}),
    },
    userContext: {
      ...DEFAULT_CONTEXT_PUBLIC_CONFIG.userContext,
      ...(rawContext.userContext && typeof rawContext.userContext === 'object'
        ? (rawContext.userContext as object)
        : {}),
    },
    projectContext: {
      ...DEFAULT_CONTEXT_PUBLIC_CONFIG.projectContext,
      ...(rawContext.projectContext && typeof rawContext.projectContext === 'object'
        ? (rawContext.projectContext as object)
        : {}),
    },
  };
  const ai =
    raw.ai && typeof raw.ai === 'object'
      ? { ...DEFAULT_AI_PUBLIC_CONFIG, ...(raw.ai as object) }
      : DEFAULT_AI_PUBLIC_CONFIG;
  const visualContext =
    raw.visualContext && typeof raw.visualContext === 'object'
      ? { ...DEFAULT_VISUAL_PUBLIC_CONFIG, ...(raw.visualContext as object) }
      : DEFAULT_VISUAL_PUBLIC_CONFIG;
  const rawVi =
    raw.visualIntelligence && typeof raw.visualIntelligence === 'object'
      ? (raw.visualIntelligence as Record<string, unknown>)
      : {};
  const visualIntelligence = {
    ...DEFAULT_VISUAL_INTELLIGENCE_CONFIG,
    ...rawVi,
    ocr: {
      ...DEFAULT_VISUAL_INTELLIGENCE_CONFIG.ocr,
      ...(rawVi.ocr && typeof rawVi.ocr === 'object' ? (rawVi.ocr as object) : {}),
    },
    vision: {
      ...DEFAULT_VISUAL_INTELLIGENCE_CONFIG.vision,
      ...(rawVi.vision && typeof rawVi.vision === 'object' ? (rawVi.vision as object) : {}),
    },
  };

  return {
    ...DEFAULT_PUBLIC_CONFIG,
    ...raw,
    schemaVersion: 1,
    featureFlags,
    capture,
    retention,
    stt,
    audioInput,
    context,
    ai,
    visualContext,
    visualIntelligence,
  };
}

export function parsePublicConfig(input: unknown) {
  return PublicConfigSchema.safeParse(mergeWithDefaults(input));
}

export function createDefaultPublicConfig() {
  return structuredClone(DEFAULT_PUBLIC_CONFIG);
}
