export const AI_WORKER_IPC_CHANNELS = {
  getPreflight: 'ai-worker:get-preflight',
  getStartupDestination: 'ai-worker:get-startup-destination',
  openSetupGuide: 'ai-worker:open-setup-guide',
  retryPreflight: 'ai-worker:retry-preflight',
  startSignIn: 'ai-worker:start-sign-in',
} as const

export const ORIGINAL_CV_IPC_CHANNELS = {
  getWorkspaceState: 'original-cv:get-workspace-state',
  importOriginalCv: 'original-cv:import',
} as const

export const TAILORED_APPLICATION_IPC_CHANNELS = {
  abandonPendingGeneration: 'tailored-application:abandon-pending-generation',
  completePendingGeneration: 'tailored-application:complete-pending-generation',
  getPendingGeneration: 'tailored-application:get-pending-generation',
  startPendingGeneration: 'tailored-application:start-pending-generation',
} as const

export const VACANCY_IPC_CHANNELS = {
  getWorkspaceState: 'vacancy:get-workspace-state',
  ingestPasted: 'vacancy:ingest-pasted',
  ingestUrl: 'vacancy:ingest-url',
  openBrowserSession: 'vacancy:open-browser-session',
} as const

export type AiWorkerIpcChannel =
  (typeof AI_WORKER_IPC_CHANNELS)[keyof typeof AI_WORKER_IPC_CHANNELS]

export type OriginalCvIpcChannel =
  (typeof ORIGINAL_CV_IPC_CHANNELS)[keyof typeof ORIGINAL_CV_IPC_CHANNELS]

export type TailoredApplicationIpcChannel =
  (typeof TAILORED_APPLICATION_IPC_CHANNELS)[keyof typeof TAILORED_APPLICATION_IPC_CHANNELS]

export type VacancyIpcChannel = (typeof VACANCY_IPC_CHANNELS)[keyof typeof VACANCY_IPC_CHANNELS]

export type DesktopIpcChannel =
  | AiWorkerIpcChannel
  | OriginalCvIpcChannel
  | TailoredApplicationIpcChannel
  | VacancyIpcChannel
