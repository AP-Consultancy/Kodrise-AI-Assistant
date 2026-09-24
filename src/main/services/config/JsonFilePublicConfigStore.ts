import fs from 'node:fs';
import path from 'node:path';
import type { PublicConfig } from '../../../shared/config/types';
import { createDefaultPublicConfig, parsePublicConfig } from '../../../core/configuration/schema';
import type { PublicConfigStore } from '../../../core/configuration/ConfigurationService';

export interface ConfigStoreLogger {
  warn: (event: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: ConfigStoreLogger = {
  warn: () => undefined,
};

/**
 * Electron-free JSON persistence for NON-SECRET public configuration.
 * Used by main with a userData path; unit-tested with temp directories.
 */
export class JsonFilePublicConfigStore implements PublicConfigStore {
  private readonly filePath: string;
  private readonly log: ConfigStoreLogger;

  constructor(baseDir: string, log: ConfigStoreLogger = noopLogger) {
    this.filePath = path.join(baseDir, 'public-config.json');
    this.log = log;
    fs.mkdirSync(baseDir, { recursive: true });
  }

  getFilePath(): string {
    return this.filePath;
  }

  load(): PublicConfig {
    if (!fs.existsSync(this.filePath)) {
      const defaults = createDefaultPublicConfig();
      this.save(defaults);
      return defaults;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsedJson: unknown = JSON.parse(raw);
      const validated = parsePublicConfig(parsedJson);
      if (!validated.success) {
        this.log.warn('config.corrupt_reset', {
          path: this.filePath,
          issues: validated.error.issues.map((issue) => issue.message),
        });
        return this.recover();
      }
      return validated.data;
    } catch (error) {
      this.log.warn('config.load_failed_reset', {
        path: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.recover();
    }
  }

  save(config: PublicConfig): void {
    const validated = parsePublicConfig(config);
    if (!validated.success) {
      throw new Error('Refusing to persist invalid public configuration');
    }
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(validated.data, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }

  private recover(): PublicConfig {
    const defaults = createDefaultPublicConfig();
    const backupPath = `${this.filePath}.corrupt-${Date.now()}`;
    if (fs.existsSync(this.filePath)) {
      try {
        fs.renameSync(this.filePath, backupPath);
      } catch {
        // ignore backup failures
      }
    }
    this.save(defaults);
    return defaults;
  }
}
