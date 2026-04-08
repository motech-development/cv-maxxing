import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

import type { KeychainBoundary } from './local-app-data-service.js'

export interface SafeStorageLike {
  decryptString: (encryptedValue: Buffer) => string
  encryptString: (value: string) => Buffer
  isEncryptionAvailable: () => boolean
}

export class SafeStorageUnavailableError extends Error {
  override name = 'SafeStorageUnavailableError'
}

export function createSafeStorageKeychain({
  keychainRecordPath,
  safeStorage,
}: {
  keychainRecordPath: string
  safeStorage: SafeStorageLike
}): KeychainBoundary {
  return {
    clearAppDataKey: async () => {
      await rm(keychainRecordPath, {
        force: true,
      })
    },
    getOrCreateAppDataKey: async () => {
      ensureSafeStorageAvailability(safeStorage)

      const existingKey = await readPersistedKey({
        keychainRecordPath,
        safeStorage,
      })

      if (existingKey !== null) {
        return existingKey
      }

      const nextKey = randomBytes(32)
      const encryptedValue = safeStorage.encryptString(nextKey.toString('base64'))

      await mkdir(path.dirname(keychainRecordPath), {
        recursive: true,
      })
      await writeFile(keychainRecordPath, encryptedValue)

      return nextKey
    },
  }
}

function ensureSafeStorageAvailability(safeStorage: SafeStorageLike): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SafeStorageUnavailableError('OS-backed encryption is unavailable.')
  }
}

async function readPersistedKey({
  keychainRecordPath,
  safeStorage,
}: {
  keychainRecordPath: string
  safeStorage: SafeStorageLike
}): Promise<Buffer | null> {
  try {
    const encryptedValue = await readFile(keychainRecordPath)
    const decryptedValue = safeStorage.decryptString(encryptedValue)

    return Buffer.from(decryptedValue, 'base64')
  } catch (error) {
    if (isMissingPathError(error)) {
      return null
    }

    throw error
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
