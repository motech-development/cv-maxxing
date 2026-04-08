import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        'dist/**',
        'src/**/*.d.ts',
        'src/renderer/main.tsx',
        'src/shared/ai-worker-preflight.ts',
        'src/shared/window-api.ts',
        'tests/e2e/**',
      ],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
    },
    exclude: ['dist/**', 'tests/e2e/**'],
  },
})
