import { defineConfig } from 'vitest/config';
import {
  desktopCoverageConfig,
  desktopIntegrationTestFiles,
  desktopTestExclude,
} from './vitest.shared.js';

export default defineConfig({
  test: {
    coverage: desktopCoverageConfig,
    exclude: desktopTestExclude,
    include: desktopIntegrationTestFiles,
  },
});
