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

export type AiWorkerIpcChannel =
  (typeof AI_WORKER_IPC_CHANNELS)[keyof typeof AI_WORKER_IPC_CHANNELS]

export type OriginalCvIpcChannel =
  (typeof ORIGINAL_CV_IPC_CHANNELS)[keyof typeof ORIGINAL_CV_IPC_CHANNELS]

export type DesktopIpcChannel = AiWorkerIpcChannel | OriginalCvIpcChannel
