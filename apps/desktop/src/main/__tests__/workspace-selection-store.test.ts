import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, test, vi } from 'vitest'

import { createLocalAppDataPaths, openLocalAppData } from '../local-app-data-service.js'
import { createWorkspaceSelectionStore } from '../workspace-selection-store.js'

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

test('persists explicit blank, draft, and saved-application workspace selections', async () => {
  const rootDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-workspace-selection-store-'),
  )

  temporaryDirectories.push(rootDirectoryPath)

  const paths = createLocalAppDataPaths(rootDirectoryPath)
  const firstStore = await openLocalAppData({
    keychain: {
      clearAppDataKey: vi.fn(() => Promise.resolve()),
      getOrCreateAppDataKey: vi.fn(() => Promise.resolve(Buffer.alloc(32, 9))),
    },
    paths,
  })
  const firstWorkspaceSelectionStore = createWorkspaceSelectionStore({
    localAppData: firstStore,
  })

  await firstWorkspaceSelectionStore.setSelection({
    kind: 'none',
  })
  await firstWorkspaceSelectionStore.setSelection({
    kind: 'draft',
  })
  await firstWorkspaceSelectionStore.setSelection({
    kind: 'tailored_application',
    tailoredApplicationId: 'tailored-application-123',
  })
  await firstStore.close()

  const secondStore = await openLocalAppData({
    keychain: {
      clearAppDataKey: vi.fn(() => Promise.resolve()),
      getOrCreateAppDataKey: vi.fn(() => Promise.resolve(Buffer.alloc(32, 9))),
    },
    paths,
  })
  const secondWorkspaceSelectionStore = createWorkspaceSelectionStore({
    localAppData: secondStore,
  })

  await expect(secondWorkspaceSelectionStore.getSelection()).resolves.toEqual({
    kind: 'tailored_application',
    tailoredApplicationId: 'tailored-application-123',
  })

  await secondStore.close()
})
