import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { createAiWorkerReadinessStore } from '../ai-worker-readiness-store.js'
import { createLocalAppDataPaths, openLocalAppData } from '../local-app-data-service.js'
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
  const rootDirectoryPath = await mkdtemp(path.join(tmpdir(), 'cv-maxxing-readiness-store-'))

  temporaryDirectories.push(rootDirectoryPath)

  return createLocalAppDataPaths(rootDirectoryPath)
}

function createKeychainBoundary(secret = Buffer.alloc(32, 7)): KeychainBoundary {
  return {
    clearAppDataKey: vi.fn(() => Promise.resolve()),
    getOrCreateAppDataKey: vi.fn(() => Promise.resolve(secret)),
  }
}

test('persists checking timeout, startup destination, and pending generation context in encrypted local app data', async () => {
  const paths = await createTestPaths()
  const firstStore = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const firstReadinessStore = createAiWorkerReadinessStore({
    localAppData: firstStore,
  })

  await firstReadinessStore.setCheckingTimeout(4800)
  await firstReadinessStore.setStartupDestination('workspace_active')
  await firstReadinessStore.savePendingGenerationCommand({
    commandId: 'command-123',
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyDraft: {
      text: 'Senior staff product designer',
      url: 'https://jobs.example.com/roles/123',
    },
  })
  await firstStore.close()

  const secondStore = await openLocalAppData({
    keychain: createKeychainBoundary(),
    paths,
  })
  const secondReadinessStore = createAiWorkerReadinessStore({
    localAppData: secondStore,
  })

  await expect(secondReadinessStore.getCheckingTimeout()).resolves.toBe(4800)
  await expect(secondReadinessStore.getStartupDestination()).resolves.toBe('workspace_active')
  await expect(secondReadinessStore.getPendingGenerationCommand()).resolves.toEqual({
    commandId: 'command-123',
    originalCvId: 'original-cv-123',
    originalCvLabel: 'ada-lovelace.pdf',
    vacancyDraft: {
      text: 'Senior staff product designer',
      url: 'https://jobs.example.com/roles/123',
    },
  })

  await secondReadinessStore.clearPendingGenerationCommand()

  await expect(secondReadinessStore.getPendingGenerationCommand()).resolves.toBeNull()

  await secondStore.close()
})
