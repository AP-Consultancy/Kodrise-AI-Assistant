import { ConfigurationError } from '../../shared/errors';
import type { PublicConfig } from '../../shared/config/types';
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
      this.config = this.store.load();
      return;
    }

    this.config = createDefaultPublicConfig();
  }

  getPublic(): PublicConfig {
    return structuredClone(this.config);
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
