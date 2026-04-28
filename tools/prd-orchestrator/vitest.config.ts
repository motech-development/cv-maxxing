import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      exclude: ['dist/**', 'src/**/*.d.ts'],
      include: ['src/**/*.ts'],
    },
    exclude: ['dist/**'],
  },
})
