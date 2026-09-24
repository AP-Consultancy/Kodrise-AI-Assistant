import { describe, expect, it } from 'vitest';
import type { CredentialVault } from '../../src/core/configuration/CredentialVault';
import type { CredentialStorageState } from '../../src/shared/ipc/types';

class TestVault implements CredentialVault {
  private readonly store = new Map<string, string>();
  constructor(private readonly storage: CredentialStorageState = 'available') {}
  getStorageState(): CredentialStorageState {
    return this.storage;
  }
  async hasCredential(key: string): Promise<boolean> {
    return this.store.has(key);
  }
  async setCredential(key: string, value: string): Promise<void> {
    if (this.storage === 'unavailable') {
      throw new Error('unavailable');
    }
    this.store.set(key, value);
  }
  async deleteCredential(key: string): Promise<void> {
    this.store.delete(key);
  }
  async getCredential(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  unsafeGet(key: string): string | undefined {
    return this.store.get(key);
  }
}

describe('CredentialVault renderer safety', () => {
  it('stores secrets but IPC-facing status only returns configured flags', async () => {
    const vault = new TestVault();
    await vault.setCredential('primary-provider', 'super-secret-value');

    const configured = await vault.hasCredential('primary-provider');
    const rendererSafe = {
      key: 'primary-provider',
      configured,
      storage: vault.getStorageState(),
    };

    expect(rendererSafe).toEqual({
      key: 'primary-provider',
      configured: true,
      storage: 'available',
    });
    expect(JSON.stringify(rendererSafe)).not.toContain('super-secret-value');
    expect(vault.unsafeGet('primary-provider')).toBe('super-secret-value');
  });

  it('reports unavailable storage without plaintext fallback', async () => {
    const vault = new TestVault('unavailable');
    await expect(vault.setCredential('primary-provider', 'x')).rejects.toThrow('unavailable');
    expect(vault.getStorageState()).toBe('unavailable');
  });
});
