import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: 'line',
  testDir: './tests/e2e',
  timeout: 30_000,
})
