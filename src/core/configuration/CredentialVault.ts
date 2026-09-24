import type { CredentialStorageState } from '../../shared/ipc/types';

export interface CredentialVault {
  /** Whether OS-backed secure storage can be used. */
  getStorageState(): CredentialStorageState;
  hasCredential(key: string): Promise<boolean>;
  setCredential(key: string, value: string): Promise<void>;
  deleteCredential(key: string): Promise<void>;
  /**
   * Main-process only. Returns plaintext for provider use.
   * Must never be exposed through IPC or the renderer API.
   */
  getCredential(key: string): Promise<string | null>;
}
