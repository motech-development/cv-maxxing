import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, expect, test, vi } from 'vitest'

import {
  LocalAppDataUnlockError,
  createLocalAppDataPaths,
  openLocalAppData,
} from '../local-app-data-service.js'
import type { KeychainBoundary, LocalAppDataPaths } from '../local-app-data-service.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      })
    }),
  )
})

async function createTestPaths(): Promise<LocalAppDataPaths> {
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-local-app-data-'))

  temporaryDirectories.push(rootDirectoryPath)

  return createLocalAppDataPaths(rootDirectoryPath)
}

function createKeychainBoundary(secret = Buffer.alloc(32, 7)): KeychainBoundary {
  return {
    clearAppDataKey: vi.fn(() => Promise.resolve()),
    getOrCreateAppDataKey: vi.fn(() => Promise.resolve(secret)),
  }
}

test('opens local app data with injected paths and round-trips metadata plus artifacts', async () => {
  const paths = await createTestPaths()
  const keychain = createKeychainBoundary()

  const store = await openLocalAppData({
    keychain,
    paths,
  })

  await store.metadata.put({
    id: 'run-123',
    scope: 'runs',
    value: {
      stage: 'input-prepared',
      status: 'active',
    },
  })

  await expect(
    store.metadata.get<{
      stage: string
      status: string
    }>({
      id: 'run-123',
      scope: 'runs',
    }),
  ).resolves.toEqual({
    stage: 'input-prepared',
    status: 'active',
  })

  await expect(store.metadata.list('runs')).resolves.toEqual([
    {
      id: 'run-123',
      value: {
        stage: 'input-prepared',
        status: 'active',
      },
    },
  ])

  await store.artifacts.write({
    content: Buffer.from('secret prompt payload', 'utf8'),
    id: 'run-123',
    name: 'input/prompt.txt',
    scope: 'runs',
  })

  await expect(
    store.artifacts.read({
      id: 'run-123',
      name: 'input/prompt.txt',
      scope: 'runs',
    }),
  ).resolves.toEqual(Buffer.from('secret prompt payload', 'utf8'))

  await expect(
    store.artifacts.list({
      id: 'run-123',
      scope: 'runs',
    }),
  ).resolves.toEqual(['input/prompt.txt'])

  const databaseBytes = await readFile(paths.databasePath)
  const plainSqlite = new DatabaseSync(paths.databasePath)

  expect(databaseBytes.includes(Buffer.from('input-prepared', 'utf8'))).toBe(false)
  expect(() => {
    plainSqlite.prepare('SELECT name FROM sqlite_master').all()
  }).toThrow(/database/i)
  plainSqlite.close()

  await store.close()
})

test('fails closed when the app-data encryption key cannot be unlocked', async () => {
  const paths = await createTestPaths()

  await expect(
    openLocalAppData({
      keychain: {
        clearAppDataKey: vi.fn(() => Promise.resolve()),
        getOrCreateAppDataKey: vi.fn(() => {
          return Promise.reject(new Error('keychain unavailable'))
        }),
      },
      paths,
    }),
  ).rejects.toBeInstanceOf(LocalAppDataUnlockError)

  await expect(readFile(paths.databasePath)).rejects.toThrow()
})

test('rejects invalid app-data keys before touching the injected paths', async () => {
  const paths = await createTestPaths()

  await expect(
    openLocalAppData({
      keychain: createKeychainBoundary(Buffer.alloc(16, 3)),
      paths,
    }),
  ).rejects.toBeInstanceOf(LocalAppDataUnlockError)

  await expect(readFile(paths.databasePath)).rejects.toThrow()
})

test('fails closed when an existing SQLCipher database is reopened with the wrong key', async () => {
  const paths = await createTestPaths()
  const firstStore = await openLocalAppData({
    keychain: createKeychainBoundary(Buffer.alloc(32, 1)),
    paths,
  })

  await firstStore.metadata.put({
    id: 'run-789',
    scope: 'runs',
    value: {
      status: 'complete',
    },
  })
  await firstStore.close()

  await expect(
    openLocalAppData({
      keychain: createKeychainBoundary(Buffer.alloc(32, 2)),
      paths,
    }),
  ).rejects.toBeInstanceOf(LocalAppDataUnlockError)
})

test('updates existing metadata records without duplicating scoped entries', async () => {
  const paths = await createTestPaths()
  const store = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })

  await store.metadata.put({
    id: 'run-321',
    scope: 'runs',
    value: {
      status: 'queued',
    },
  })
  await store.metadata.put({
    id: 'run-321',
    scope: 'runs',
    value: {
      status: 'complete',
    },
  })

  await expect(
    store.metadata.get({
      id: 'run-321',
      scope: 'runs',
    }),
  ).resolves.toEqual({
    status: 'complete',
  })
  await expect(store.metadata.list('runs')).resolves.toEqual([
    {
      id: 'run-321',
      value: {
        status: 'complete',
      },
    },
  ])

  await store.close()
})

test('deletes scoped data for cleanup flows and resets all local app data', async () => {
  const paths = await createTestPaths()
  const keychain = createKeychainBoundary()

  const store = await openLocalAppData({
    keychain,
    paths,
  })

  await store.metadata.put({
    id: 'run-123',
    scope: 'runs',
    value: {
      status: 'cancelled',
    },
  })
  await store.metadata.put({
    id: 'application-123',
    scope: 'tailored-applications',
    value: {
      status: 'ready',
    },
  })
  await store.artifacts.write({
    content: Buffer.from('partial run output', 'utf8'),
    id: 'run-123',
    name: 'output/partial.json',
    scope: 'runs',
  })
  await store.artifacts.write({
    content: Buffer.from('final cover letter', 'utf8'),
    id: 'application-123',
    name: 'cover-letter.pdf',
    scope: 'tailored-applications',
  })

  await store.deleteScopedData({
    id: 'run-123',
    scope: 'runs',
  })

  await expect(
    store.metadata.get({
      id: 'run-123',
      scope: 'runs',
    }),
  ).resolves.toBeNull()
  await expect(
    store.artifacts.list({
      id: 'run-123',
      scope: 'runs',
    }),
  ).resolves.toEqual([])
  await expect(
    store.metadata.get({
      id: 'application-123',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual({
    status: 'ready',
  })

  await store.reset()

  await expect(store.metadata.list('tailored-applications')).resolves.toEqual([])
  await expect(
    store.artifacts.list({
      id: 'application-123',
      scope: 'tailored-applications',
    }),
  ).resolves.toEqual([])
  expect(keychain.clearAppDataKey).toHaveBeenCalledTimes(1)

  await store.close()
})

test('deletes the final scoped artifact and removes its encrypted manifest entry', async () => {
  const paths = await createTestPaths()
  const store = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })

  await store.artifacts.write({
    content: Buffer.from('transient run payload', 'utf8'),
    id: 'run-456',
    name: 'output/final.json',
    scope: 'runs',
  })
  await store.artifacts.delete({
    id: 'run-456',
    name: 'output/final.json',
    scope: 'runs',
  })

  await expect(
    store.artifacts.read({
      id: 'run-456',
      name: 'output/final.json',
      scope: 'runs',
    }),
  ).resolves.toBeNull()
  await expect(
    store.artifacts.list({
      id: 'run-456',
      scope: 'runs',
    }),
  ).resolves.toEqual([])

  await store.close()
})

test('rejects corrupted encrypted artifact manifests instead of returning partial data', async () => {
  const paths = await createTestPaths()
  const store = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })

  await store.artifacts.write({
    content: Buffer.from('cover letter payload', 'utf8'),
    id: 'application-456',
    name: 'cover-letter.pdf',
    scope: 'tailored-applications',
  })
  await writeFile(
    path.join(paths.artifactsRoot, 'tailored-applications', 'application-456', 'manifest.bin'),
    Buffer.from([0]),
  )

  await expect(
    store.artifacts.list({
      id: 'application-456',
      scope: 'tailored-applications',
    }),
  ).rejects.toThrow('Unsupported encrypted payload version.')

  await store.close()
})
