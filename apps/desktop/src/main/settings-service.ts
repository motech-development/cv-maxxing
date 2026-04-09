import { rm } from 'node:fs/promises'

import type {
  ResetLocalAppDataInput,
  SettingsPrivacyState,
  SettingsSnapshot,
} from '../shared/settings.js'
import { SETTINGS_RESET_CONFIRMATION_PHRASE } from '../shared/settings.js'
import type { LocalAppDataStore } from './local-app-data-service.js'

const blockedPrivacyState: SettingsPrivacyState = {
  analytics: false,
  automaticUpdateChecks: false,
  crashReporting: false,
  remoteConfig: false,
  runtimeFontCdnCalls: false,
  telemetry: false,
}

const resolveVoid = (): Promise<void> => {
  return Promise.resolve()
}

export interface SettingsService {
  clearJobSiteBrowserData: () => Promise<void>
  getSettingsSnapshot: () => Promise<SettingsSnapshot>
  resetLocalAppData: (input: ResetLocalAppDataInput) => Promise<void>
}

export class InvalidLocalDataResetConfirmationError extends Error {
  override name = 'InvalidLocalDataResetConfirmationError'
}

interface SettingsServiceOptions {
  browserSessionRootPath: string
  closeActiveJobs?: () => Promise<void>
  getAppVersion: () => string
  localAppData: Pick<LocalAppDataStore, 'reset'>
  restartApp?: () => Promise<void>
  workerCommand?: string
}

export function createSettingsService({
  browserSessionRootPath,
  closeActiveJobs = resolveVoid,
  getAppVersion,
  localAppData,
  restartApp = resolveVoid,
  workerCommand = 'codex',
}: SettingsServiceOptions): SettingsService {
  return {
    clearJobSiteBrowserData: async (): Promise<void> => {
      await rm(browserSessionRootPath, {
        force: true,
        recursive: true,
      })
    },
    getSettingsSnapshot: (): Promise<SettingsSnapshot> => {
      return Promise.resolve({
        appVersion: getAppVersion(),
        privacy: blockedPrivacyState,
        workerCommand,
      })
    },
    resetLocalAppData: async ({ confirmationPhrase }: ResetLocalAppDataInput): Promise<void> => {
      if (confirmationPhrase !== SETTINGS_RESET_CONFIRMATION_PHRASE) {
        throw new InvalidLocalDataResetConfirmationError(
          `Type ${SETTINGS_RESET_CONFIRMATION_PHRASE} to confirm the destructive reset.`,
        )
      }

      await closeActiveJobs()
      await localAppData.reset()
      await restartApp()
    },
  }
}
