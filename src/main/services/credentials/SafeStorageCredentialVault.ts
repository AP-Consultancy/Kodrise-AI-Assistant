import fs from 'node:fs';
import path from 'node:path';
import { app, safeStorage } from 'electron';
import { ConfigurationError } from '../../../shared/errors';
import type { CredentialVault } from '../../../core/configuration/CredentialVault';
import type { CredentialStorageState } from '../../../shared/ipc/types';
import { logger } from '../logging';

interface CredentialFile {
  schemaVersion: 1;
  entries: Record<string, string>;
}

/**
 * Encrypts credential values with Electron safeStorage and stores ciphertext on disk.
 * Never returns plaintext over IPC. No plaintext fallback.
 */
export class SafeStorageCredentialVault implements CredentialVault {
  private readonly filePath: string;

  constructor(baseDir = path.join(app.getPath('userData'), 'credentials')) {
    this.filePath = path.join(baseDir, 'vault.json');
    fs.mkdirSync(baseDir, { recursive: true });
  }

  getStorageState(): CredentialStorageState {
    return safeStorage.isEncryptionAvailable() ? 'available' : 'unavailable';
  }

  async hasCredential(key: string): Promise<boolean> {
    const file = this.readFile();
    return Object.prototype.hasOwnProperty.call(file.entries, key);
  }

  async setCredential(key: string, value: string): Promise<void> {
    this.assertAvailable();
    const encrypted = safeStorage.encryptString(value).toString('base64');
    const file = this.readFile();
    file.entries[key] = encrypted;
    this.writeFile(file);
    logger.info('credentials.set', { key, configured: true, storage: 'available' });
  }

  async deleteCredential(key: string): Promise<void> {
    const file = this.readFile();
    delete file.entries[key];
    this.writeFile(file);
    logger.info('credentials.delete', { key, configured: false });
  }

  async getCredential(key: string): Promise<string | null> {
    this.assertAvailable();
    const file = this.readFile();
    const encrypted = file.entries[key];
    if (!encrypted) {
      return null;
    }
    try {
      const buffer = Buffer.from(encrypted, 'base64');
      return safeStorage.decryptString(buffer);
    } catch {
      throw new ConfigurationError('Failed to decrypt credential', { key });
    }
  }

  private assertAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new ConfigurationError(
        'Secure credential storage is unavailable on this platform/session',
        { storage: 'unavailable' },
      );
    }
  }

  private readFile(): CredentialFile {
    if (!fs.existsSync(this.filePath)) {
      return { schemaVersion: 1, entries: {} };
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as CredentialFile;
      if (parsed.schemaVersion !== 1 || typeof parsed.entries !== 'object' || !parsed.entries) {
        return { schemaVersion: 1, entries: {} };
      }
      return parsed;
    } catch {
      return { schemaVersion: 1, entries: {} };
    }
  }

  private writeFile(file: CredentialFile): void {
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }
}
