export type AiWorkerProvider = 'codex';

export type AiWorkerPreflightStatus = 'checking' | 'ready' | 'sign_in_required' | 'unavailable';

export type AiWorkerFailureCode =
  | 'auth_expired'
  | 'auth_missing'
  | 'healthcheck_failed'
  | 'launch_failed'
  | 'runtime_missing';

export type AiWorkerPreflightResult =
  | {
      canResumeGeneration: false;
      message: string;
      provider: AiWorkerProvider;
      status: 'checking';
    }
  | {
      canResumeGeneration: true;
      message: string;
      provider: AiWorkerProvider;
      status: 'ready';
    }
  | {
      canResumeGeneration: boolean;
      failureCode: 'auth_expired' | 'auth_missing';
      message: string;
      provider: AiWorkerProvider;
      status: 'sign_in_required';
    }
  | {
      canResumeGeneration: false;
      failureCode: 'healthcheck_failed' | 'launch_failed' | 'runtime_missing';
      message: string;
      provider: AiWorkerProvider;
      status: 'unavailable';
    };

export interface AiWorkerPreflightProvider {
  getAiWorkerPreflight: () => Promise<AiWorkerPreflightResult>;
}
