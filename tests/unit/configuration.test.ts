import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigurationService } from '../../src/core/configuration/ConfigurationService';
import { ConfigurationError } from '../../src/shared/errors';
import { JsonFilePublicConfigStore } from '../../src/main/services/config/JsonFilePublicConfigStore';

describe('ConfigurationService', () => {
  it('returns default public configuration', () => {
    const service = new ConfigurationService();
    const config = service.getPublic();
    expect(config.schemaVersion).toBe(1);
    expect(config.capture.requireExplicitConsent).toBe(true);
  });

  it('applies a valid public update', () => {
    const service = new ConfigurationService();
    const updated = service.update({
      theme: 'dark',
      selectedModelId: 'demo-model',
      stt: { model: 'nova-3', language: 'en' },
    });
    expect(updated.theme).toBe('dark');
    expect(updated.selectedModelId).toBe('demo-model');
    expect(updated.stt.provider).toBe('deepgram');
    expect(updated.stt.model).toBe('nova-3');
  });

  it('merges missing stt block from older config documents', () => {
    const service = new ConfigurationService({
      initial: {
        schemaVersion: 1,
        theme: 'light',
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
        },
        retention: {
          historyRetentionDays: 30,
          logRetentionDays: 14,
        },
      } as never,
    });
    expect(service.getPublic().stt.provider).toBe('deepgram');
  });

  it('rejects invalid configuration updates', () => {
    const service = new ConfigurationService();
    expect(() => service.update({ language: '' })).toThrow(ConfigurationError);
  });

  it('persists and reloads public configuration from disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-config-'));
    const store = new JsonFilePublicConfigStore(dir);
    const service = new ConfigurationService({ store });
    service.update({ theme: 'light', selectedModelId: 'persisted-model' });

    const reloaded = new ConfigurationService({ store: new JsonFilePublicConfigStore(dir) });
    expect(reloaded.getPublic().theme).toBe('light');
    expect(reloaded.getPublic().selectedModelId).toBe('persisted-model');
  });

  it('recovers from corrupt configuration files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-config-bad-'));
    const store = new JsonFilePublicConfigStore(dir);
    fs.writeFileSync(store.getFilePath(), '{not-json', 'utf8');
    const loaded = store.load();
    expect(loaded.schemaVersion).toBe(1);
  });
});
