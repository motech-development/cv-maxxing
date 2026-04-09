import { randomUUID } from 'node:crypto'

import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type { PendingGenerationCommand } from '../shared/pending-generation.js'
import type { AiWorkerPreflightService } from './ai-worker-preflight-service.js'
import type { AiWorkerReadinessStore } from './ai-worker-readiness-store.js'

export interface StartPendingGenerationInput {
  originalCvId: string
  originalCvLabel: string
  vacancyDraft: PendingGenerationCommand['vacancyDraft']
}

export interface TailoredApplicationSessionService {
  abandonPendingGeneration: () => Promise<void>
  completePendingGeneration: (commandId: string) => Promise<void>
  getPendingGenerationCommand: () => Promise<PendingGenerationCommand | null>
  startPendingGeneration: (input: StartPendingGenerationInput) => Promise<AiWorkerPreflightResult>
}

interface CreateTailoredApplicationSessionServiceOptions {
  aiWorker: Pick<AiWorkerPreflightService, 'retryAiWorkerPreflight'>
  generateId?: () => string
  readinessStore: Pick<
    AiWorkerReadinessStore,
    | 'clearPendingGenerationCommand'
    | 'getPendingGenerationCommand'
    | 'savePendingGenerationCommand'
    | 'setStartupDestination'
  >
}

export function createTailoredApplicationSessionService({
  aiWorker,
  generateId = randomUUID,
  readinessStore,
}: CreateTailoredApplicationSessionServiceOptions): TailoredApplicationSessionService {
  return {
    abandonPendingGeneration: async () => {
      await readinessStore.clearPendingGenerationCommand()
      await readinessStore.setStartupDestination('workspace_empty')
    },
    completePendingGeneration: async (commandId) => {
      const pendingGenerationCommand = await readinessStore.getPendingGenerationCommand()

      if (pendingGenerationCommand?.commandId !== commandId) {
        throw new Error('Pending generation command mismatch.')
      }

      await readinessStore.clearPendingGenerationCommand()
      await readinessStore.setStartupDestination('workspace_active')
    },
    getPendingGenerationCommand: async () => {
      return await readinessStore.getPendingGenerationCommand()
    },
    startPendingGeneration: async ({
      originalCvId,
      originalCvLabel,
      vacancyDraft,
    }: StartPendingGenerationInput) => {
      await readinessStore.savePendingGenerationCommand({
        commandId: generateId(),
        originalCvId,
        originalCvLabel,
        vacancyDraft: {
          text: vacancyDraft.text,
          url: vacancyDraft.url,
        },
      })
      await readinessStore.setStartupDestination('workspace_loading')

      return await aiWorker.retryAiWorkerPreflight()
    },
  }
}
