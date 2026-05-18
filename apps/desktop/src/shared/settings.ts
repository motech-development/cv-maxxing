import type { AiWorkerProvider } from './ai-worker-preflight.js';

export const SETTINGS_RESET_CONFIRMATION_PHRASE = 'RESET';

export interface SettingsSnapshot {
  appVersion: string;
  workerCommand: string;
  workerProvider: AiWorkerProvider;
}

export interface ResetLocalAppDataInput {
  confirmationPhrase: string;
}
