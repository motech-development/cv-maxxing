import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { createLocalAppDataPaths } from '../local-app-data-service.js';
import {
  createSafeStorageKeychain,
  SafeStorageUnavailableError,
} from '../safe-storage-keychain.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      });
    }),
  );
});

async function createKeychainRecordPath(): Promise<string> {
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-safe-storage-'));

  temporaryDirectories.push(rootDirectoryPath);

  return createLocalAppDataPaths(rootDirectoryPath).keychainRecordPath;
}

function createSafeStorageDouble() {
  return {
    decryptString: vi.fn((encryptedValue: Buffer) => {
      return Buffer.from(encryptedValue.toString('utf8'), 'hex').toString('utf8');
    }),
    encryptString: vi.fn((value: string) => {
      return Buffer.from(Buffer.from(value, 'utf8').toString('hex'), 'utf8');
    }),
    isEncryptionAvailable: vi.fn(() => true),
  };
}

test('creates and persists the app-data key through the safeStorage boundary', async () => {
  const keychainRecordPath = await createKeychainRecordPath();
  const safeStorage = createSafeStorageDouble();

  const keychain = createSafeStorageKeychain({
    keychainRecordPath,
    safeStorage,
  });

  const firstKey = await keychain.getOrCreateAppDataKey();
  const secondKey = await keychain.getOrCreateAppDataKey();

  expect(firstKey.byteLength).toBe(32);
  expect(secondKey.equals(firstKey)).toBe(true);
  expect(safeStorage.encryptString).toHaveBeenCalledTimes(1);

  const persistedBytes = await readFile(keychainRecordPath);

  expect(persistedBytes.toString('utf8')).not.toContain(firstKey.toString('base64'));
});

test('clears the persisted safeStorage record during destructive reset', async () => {
  const keychainRecordPath = await createKeychainRecordPath();
  const keychain = createSafeStorageKeychain({
    keychainRecordPath,
    safeStorage: createSafeStorageDouble(),
  });

  await keychain.getOrCreateAppDataKey();
  await keychain.clearAppDataKey();

  await expect(readFile(keychainRecordPath)).rejects.toThrow();
});

test('fails closed when safeStorage cannot access OS-backed encryption', async () => {
  const keychain = createSafeStorageKeychain({
    keychainRecordPath: await createKeychainRecordPath(),
    safeStorage: {
      decryptString: vi.fn(),
      encryptString: vi.fn(),
      isEncryptionAvailable: vi.fn(() => false),
    },
  });

  await expect(keychain.getOrCreateAppDataKey()).rejects.toBeInstanceOf(
    SafeStorageUnavailableError,
  );
});
