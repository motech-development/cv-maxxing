import type { AiWorkerProvider } from './ai-worker-preflight.js';

const aiWorkerProviderDisplayNames = {
  codex: 'Codex',
} satisfies Record<AiWorkerProvider, string>;

export function formatAiWorkerProviderName(provider: AiWorkerProvider) {
  return aiWorkerProviderDisplayNames[provider];
}
