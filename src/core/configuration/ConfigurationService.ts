import { ConfigurationError } from '../../shared/errors';
import type { PublicConfig } from '../../shared/config/types';
import {
  DEFAULT_APPEARANCE_PUBLIC_CONFIG,
  DEFAULT_AUDIO_INPUT_PUBLIC_CONFIG,
  DEFAULT_QUESTION_CAPTURE_CONFIG,
} from '../../shared/config/types';
import { createDefaultPublicConfig, parsePublicConfig, PublicConfigUpdateSchema } from './schema';

export interface PublicConfigStore {
  load(): PublicConfig;
  save(config: PublicConfig): void;
}

export class ConfigurationService {
  private config: PublicConfig;
  private readonly store: PublicConfigStore | null;

  constructor(options?: { initial?: PublicConfig; store?: PublicConfigStore }) {
    this.store = options?.store ?? null;

    if (options?.initial) {
      const parsed = parsePublicConfig(options.initial);
      if (!parsed.success) {
        throw new ConfigurationError('Invalid initial public configuration', {
          issues: parsed.error.issues.map((issue) => issue.message),
        });
      }
      this.config = parsed.data;
      return;
    }

    if (this.store) {
      // Always re-parse so older on-disk configs gain new fields (e.g. audioInput).
      const loaded = this.store.load();
      const normalized = parsePublicConfig(loaded);
      this.config = normalized.success ? normalized.data : createDefaultPublicConfig();
      const needsPersist =
        !loaded.audioInput ||
        loaded.audioInput.inputMode == null ||
        (normalized.success && loaded.ai?.model !== this.config.ai.model);
      if (needsPersist) {
        this.store.save(this.config);
      }
      return;
    }

    this.config = createDefaultPublicConfig();
  }

  getPublic(): PublicConfig {
    const clone = structuredClone(this.config);
    if (!clone.audioInput) {
      clone.audioInput = { ...DEFAULT_AUDIO_INPUT_PUBLIC_CONFIG };
    }
    if (!clone.appearance) {
      clone.appearance = { ...DEFAULT_APPEARANCE_PUBLIC_CONFIG };
    }
    if (!clone.questionCapture) {
      clone.questionCapture = { ...DEFAULT_QUESTION_CAPTURE_CONFIG };
    }
    return clone;
  }

  update(patch: unknown): PublicConfig {
    const parsedPatch = PublicConfigUpdateSchema.safeParse(patch);
    if (!parsedPatch.success) {
      throw new ConfigurationError('Invalid configuration update', {
        issues: parsedPatch.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ),
      });
    }

    const next: PublicConfig = {
      ...this.config,
      ...parsedPatch.data,
      featureFlags: {
        ...this.config.featureFlags,
        ...parsedPatch.data.featureFlags,
      },
      capture: {
        ...this.config.capture,
        ...parsedPatch.data.capture,
        requireExplicitConsent: true,
        showCaptureStatusBanner: true,
        windowPrivacyPolicy:
          parsedPatch.data.capture?.windowPrivacyPolicy ?? this.config.capture.windowPrivacyPolicy,
      },
      retention: {
        ...this.config.retention,
        ...parsedPatch.data.retention,
      },
      stt: {
        ...this.config.stt,
        ...parsedPatch.data.stt,
      },
      audioInput: {
        ...DEFAULT_AUDIO_INPUT_PUBLIC_CONFIG,
        ...this.config.audioInput,
        ...parsedPatch.data.audioInput,
      },
      context: {
        budget: {
          ...this.config.context.budget,
          ...parsedPatch.data.context?.budget,
        },
        userContext: parsedPatch.data.context?.userContext
          ? { ...this.config.context.userContext, ...parsedPatch.data.context.userContext }
          : this.config.context.userContext,
        projectContext: parsedPatch.data.context?.projectContext
          ? { ...this.config.context.projectContext, ...parsedPatch.data.context.projectContext }
          : this.config.context.projectContext,
      },
      ai: {
        ...this.config.ai,
        ...parsedPatch.data.ai,
      },
      visualContext: {
        ...this.config.visualContext,
        ...parsedPatch.data.visualContext,
      },
      visualIntelligence: {
        ...this.config.visualIntelligence,
        ...parsedPatch.data.visualIntelligence,
        ocr: {
          ...this.config.visualIntelligence.ocr,
          ...parsedPatch.data.visualIntelligence?.ocr,
        },
        vision: {
          ...this.config.visualIntelligence.vision,
          ...parsedPatch.data.visualIntelligence?.vision,
        },
      },
      appearance: {
        ...DEFAULT_APPEARANCE_PUBLIC_CONFIG,
        ...this.config.appearance,
        ...parsedPatch.data.appearance,
      },
      questionCapture: {
        ...DEFAULT_QUESTION_CAPTURE_CONFIG,
        ...this.config.questionCapture,
        ...parsedPatch.data.questionCapture,
      },
      schemaVersion: 1,
    };

    const validated = parsePublicConfig(next);
    if (!validated.success) {
      throw new ConfigurationError('Configuration update produced an invalid document', {
        issues: validated.error.issues.map((issue) => issue.message),
      });
    }

    this.config = validated.data;
    this.store?.save(this.config);
    return this.getPublic();
  }
}
