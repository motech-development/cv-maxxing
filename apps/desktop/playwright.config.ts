import { defineConfig } from '@playwright/test'

export default defineConfig({
  outputDir: 'test-results/playwright',
  reporter:
    process.env.CI === 'true' ? [['github'], ['html', { open: 'never' }], ['line']] : 'line',
  testDir: './tests/e2e',
  timeout: 45_000,
  use: {
    viewport: {
      height: 900,
      width: 1440,
    },
  },
  projects: [
    {
      name: 'smoke',
      testMatch: /.*smoke\.test\.ts/u,
    },
    {
      name: 'visual',
      testMatch: /.*visual\.test\.ts/u,
    },
  ],
})
