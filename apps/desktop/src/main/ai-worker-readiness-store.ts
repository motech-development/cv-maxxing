import type { PendingGenerationCommand } from '../shared/pending-generation.js'
import type { StartupDestination } from '../shared/startup-destination.js'
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js'

const APP_CONFIG_SCOPE = 'app-config'
const APP_CONFIG_ENTRY_ID = 'ai-worker'
const PENDING_GENERATION_SCOPE = 'pending-generation'
const PENDING_GENERATION_ENTRY_ID = 'active-command'
const STARTUP_SCOPE = 'startup'
const STARTUP_ENTRY_ID = 'destination'

export interface AiWorkerReadinessStore {
  clearPendingGenerationCommand: () => Promise<void>
  getCheckingTimeout: () => Promise<number | null>
  getPendingGenerationCommand: () => Promise<PendingGenerationCommand | null>
  getStartupDestination: () => Promise<StartupDestination | null>
  savePendingGenerationCommand: (command: PendingGenerationCommand) => Promise<void>
  setCheckingTimeout: (timeoutMs: number) => Promise<void>
  setStartupDestination: (destination: StartupDestination) => Promise<void>
}

export function createAiWorkerReadinessStore({
  localAppData,
}: {
  localAppData: Pick<LocalAppDataStore, 'metadata'>
}): AiWorkerReadinessStore {
  return {
    clearPendingGenerationCommand: async () => {
      await localAppData.metadata.delete({
        id: PENDING_GENERATION_ENTRY_ID,
        scope: PENDING_GENERATION_SCOPE,
      })
    },
    getCheckingTimeout: async () => {
      const value: unknown = await localAppData.metadata.get({
        id: APP_CONFIG_ENTRY_ID,
        scope: APP_CONFIG_SCOPE,
      })

      if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('checkingTimeout' in value) ||
        typeof value.checkingTimeout !== 'number' ||
        value.checkingTimeout <= 0
      ) {
        return null
      }

      return Math.trunc(value.checkingTimeout)
    },
    getPendingGenerationCommand: async () => {
      const value: unknown = await localAppData.metadata.get({
        id: PENDING_GENERATION_ENTRY_ID,
        scope: PENDING_GENERATION_SCOPE,
      })

      return isPendingGenerationCommand(value) ? value : null
    },
    getStartupDestination: async () => {
      const value: unknown = await localAppData.metadata.get({
        id: STARTUP_ENTRY_ID,
        scope: STARTUP_SCOPE,
      })

      return normalizeStartupDestination(value)
    },
    savePendingGenerationCommand: async (command) => {
      await localAppData.metadata.put({
        id: PENDING_GENERATION_ENTRY_ID,
        scope: PENDING_GENERATION_SCOPE,
        value: {
          commandId: command.commandId,
          originalCvId: command.originalCvId,
          originalCvLabel: command.originalCvLabel,
          vacancyId: command.vacancyId,
          vacancyDraft: {
            text: command.vacancyDraft.text,
            url: command.vacancyDraft.url,
          } satisfies Record<string, JsonValue>,
        } satisfies Record<string, JsonValue>,
      })
    },
    setCheckingTimeout: async (timeoutMs) => {
      await localAppData.metadata.put({
        id: APP_CONFIG_ENTRY_ID,
        scope: APP_CONFIG_SCOPE,
        value: {
          checkingTimeout: Math.trunc(timeoutMs),
        } satisfies Record<string, JsonValue>,
      })
    },
    setStartupDestination: async (destination) => {
      await localAppData.metadata.put({
        id: STARTUP_ENTRY_ID,
        scope: STARTUP_SCOPE,
        value: destination,
      })
    },
  }
}

function isPendingGenerationCommand(value: unknown): value is PendingGenerationCommand {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.commandId === 'string' &&
    typeof candidate.originalCvId === 'string' &&
    typeof candidate.originalCvLabel === 'string' &&
    typeof candidate.vacancyId === 'string' &&
    'vacancyDraft' in candidate &&
    candidate.vacancyDraft !== null &&
    typeof candidate.vacancyDraft === 'object' &&
    !Array.isArray(candidate.vacancyDraft) &&
    'text' in candidate.vacancyDraft &&
    typeof candidate.vacancyDraft.text === 'string' &&
    'url' in candidate.vacancyDraft &&
    typeof candidate.vacancyDraft.url === 'string'
  )
}

function normalizeStartupDestination(value: unknown): StartupDestination | null {
  if (value === 'workspace_loading') {
    return 'workspace'
  }

  return value === 'first_launch' || value === 'workspace' ? value : null
}
