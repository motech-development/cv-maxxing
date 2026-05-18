import { rm } from 'node:fs/promises';
import type { AiWorkerProvider } from '../shared/ai-worker-preflight.js';
import type { ResetLocalAppDataInput, SettingsSnapshot } from '../shared/settings.js';
import { SETTINGS_RESET_CONFIRMATION_PHRASE } from '../shared/settings.js';
import type { LocalAppDataStore } from './local-app-data-service.js';

const resolveVoid = (): Promise<void> => {
  return Promise.resolve();
};

export interface SettingsService {
  clearJobSiteBrowserData: () => Promise<void>;
  getSettingsSnapshot: () => Promise<SettingsSnapshot>;
  resetLocalAppData: (input: ResetLocalAppDataInput) => Promise<void>;
}

export class InvalidLocalDataResetConfirmationError extends Error {
  override name = 'InvalidLocalDataResetConfirmationError';
}

interface SettingsServiceOptions {
  allowResetLocalAppDataErrorMessage?: boolean;
  browserSessionRootPath: string;
  closeActiveJobs?: () => Promise<void>;
  getAppVersion: () => string;
  localAppData: Pick<LocalAppDataStore, 'reset'>;
  resetLocalAppDataErrorMessage?: string;
  restartApp?: () => Promise<void>;
  workerCommand?: string;
  workerProvider?: AiWorkerProvider;
}

export function createSettingsService({
  allowResetLocalAppDataErrorMessage = false,
  browserSessionRootPath,
  closeActiveJobs = resolveVoid,
  getAppVersion,
  localAppData,
  resetLocalAppDataErrorMessage,
  restartApp = resolveVoid,
  workerCommand = 'codex',
  workerProvider = 'codex',
}: SettingsServiceOptions): SettingsService {
  return {
    clearJobSiteBrowserData: async (): Promise<void> => {
      await rm(browserSessionRootPath, {
        force: true,
        recursive: true,
      });
    },
    getSettingsSnapshot: (): Promise<SettingsSnapshot> => {
      return Promise.resolve({
        appVersion: getAppVersion(),
        workerCommand,
        workerProvider,
      });
    },
    resetLocalAppData: async ({ confirmationPhrase }: ResetLocalAppDataInput): Promise<void> => {
      if (confirmationPhrase !== SETTINGS_RESET_CONFIRMATION_PHRASE) {
        throw new InvalidLocalDataResetConfirmationError(
          `Type ${SETTINGS_RESET_CONFIRMATION_PHRASE} to confirm the destructive reset.`,
        );
      }

      if (
        allowResetLocalAppDataErrorMessage &&
        resetLocalAppDataErrorMessage !== undefined &&
        resetLocalAppDataErrorMessage.trim() !== ''
      ) {
        throw new Error(resetLocalAppDataErrorMessage);
      }

      await closeActiveJobs();
      await localAppData.reset();
      await restartApp();
    },
  };
}
