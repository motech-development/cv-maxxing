import { expect, test, vi } from 'vitest'

import { AI_WORKER_IPC_CHANNELS, ORIGINAL_CV_IPC_CHANNELS } from '../../shared/ipc.js'
import { createDesktopApi } from '../create-desktop-api.js'

test('preload exposes the AI worker onboarding queries and commands over typed IPC', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    })
    .mockResolvedValueOnce({
      canResumeGeneration: false,
      failureCode: 'runtime_missing',
      message: 'The local AI worker is unavailable. Check setup, then retry.',
      provider: 'codex',
      status: 'unavailable',
    })
    .mockResolvedValueOnce({
      canResumeGeneration: true,
      message: 'The local AI worker is ready.',
      provider: 'codex',
      status: 'ready',
    })
    .mockResolvedValueOnce('workspace_active')
    .mockImplementationOnce(() => Promise.resolve())
    .mockResolvedValueOnce({
      activeOriginalCv: {
        fileType: 'pdf',
        headline: 'Principal Product Designer',
        id: 'original-cv-123',
        importedAt: '2026-04-08T14:30:00.000Z',
        originalFilename: 'ada-lovelace.pdf',
        pageCount: 1,
        snapshotCount: 1,
        summary: 'Design leader focused on complex workflow products.',
        writingStyle: {
          averageSentenceLength: 7,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'direct',
        },
      },
      snapshotCount: 1,
    })
    .mockResolvedValueOnce({
      kind: 'imported',
      originalCv: {
        fileType: 'docx',
        headline: 'Staff Product Designer',
        id: 'original-cv-456',
        importedAt: '2026-04-08T15:10:00.000Z',
        originalFilename: 'ada-lovelace-revised.docx',
        pageCount: 1,
        snapshotCount: 2,
        summary: 'Product designer adapting CVs for desktop AI tooling.',
        writingStyle: {
          averageSentenceLength: 8,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'direct',
        },
      },
    })

  const desktopApi = createDesktopApi({
    invoke,
  })

  await expect(desktopApi.aiWorker.getAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })
  await expect(desktopApi.aiWorker.retryAiWorkerPreflight()).resolves.toEqual({
    canResumeGeneration: false,
    failureCode: 'runtime_missing',
    message: 'The local AI worker is unavailable. Check setup, then retry.',
    provider: 'codex',
    status: 'unavailable',
  })
  await expect(desktopApi.aiWorker.startAiWorkerSignIn()).resolves.toEqual({
    canResumeGeneration: true,
    message: 'The local AI worker is ready.',
    provider: 'codex',
    status: 'ready',
  })
  await expect(desktopApi.aiWorker.getStartupDestination()).resolves.toBe('workspace_active')
  await expect(desktopApi.aiWorker.openAiWorkerSetupGuide()).resolves.toBeUndefined()
  await expect(desktopApi.originalCv.getOriginalCvWorkspaceState()).resolves.toEqual({
    activeOriginalCv: {
      fileType: 'pdf',
      headline: 'Principal Product Designer',
      id: 'original-cv-123',
      importedAt: '2026-04-08T14:30:00.000Z',
      originalFilename: 'ada-lovelace.pdf',
      pageCount: 1,
      snapshotCount: 1,
      summary: 'Design leader focused on complex workflow products.',
      writingStyle: {
        averageSentenceLength: 7,
        clicheDetections: [],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    },
    snapshotCount: 1,
  })
  await expect(
    desktopApi.originalCv.importOriginalCv({
      content: new Uint8Array([80, 68, 70]),
      filename: 'ada-lovelace-revised.docx',
    }),
  ).resolves.toEqual({
    kind: 'imported',
    originalCv: {
      fileType: 'docx',
      headline: 'Staff Product Designer',
      id: 'original-cv-456',
      importedAt: '2026-04-08T15:10:00.000Z',
      originalFilename: 'ada-lovelace-revised.docx',
      pageCount: 1,
      snapshotCount: 2,
      summary: 'Product designer adapting CVs for desktop AI tooling.',
      writingStyle: {
        averageSentenceLength: 8,
        clicheDetections: [],
        firstPersonUsage: 'absent',
        formality: 'direct',
      },
    },
  })

  expect(invoke).toHaveBeenNthCalledWith(1, AI_WORKER_IPC_CHANNELS.getPreflight)
  expect(invoke).toHaveBeenNthCalledWith(2, AI_WORKER_IPC_CHANNELS.retryPreflight)
  expect(invoke).toHaveBeenNthCalledWith(3, AI_WORKER_IPC_CHANNELS.startSignIn)
  expect(invoke).toHaveBeenNthCalledWith(4, AI_WORKER_IPC_CHANNELS.getStartupDestination)
  expect(invoke).toHaveBeenNthCalledWith(5, AI_WORKER_IPC_CHANNELS.openSetupGuide)
  expect(invoke).toHaveBeenNthCalledWith(6, ORIGINAL_CV_IPC_CHANNELS.getWorkspaceState)
  expect(invoke).toHaveBeenNthCalledWith(7, ORIGINAL_CV_IPC_CHANNELS.importOriginalCv, {
    content: new Uint8Array([80, 68, 70]),
    filename: 'ada-lovelace-revised.docx',
  })
})
