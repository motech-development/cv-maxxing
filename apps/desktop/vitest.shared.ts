export const desktopCoverageConfig = {
  exclude: [
    'dist/**',
    'src/**/*.d.ts',
    'src/renderer/main.tsx',
    'src/shared/ai-worker-preflight.ts',
    'src/shared/window-api.ts',
    'tests/e2e/**',
  ],
  include: ['src/**/*.ts', 'src/**/*.tsx'],
};

export const desktopTestExclude = ['dist/**', 'tests/e2e/**'];

export const desktopIntegrationTestFiles = [
  'src/main/__tests__/local-app-data-service.test.ts',
  'src/main/__tests__/main.test.ts',
  'src/main/__tests__/original-cv-service.test.ts',
  'src/main/__tests__/settings-bootstrap.test.ts',
  'src/main/__tests__/settings-service.test.ts',
  'src/main/__tests__/tailored-application-generation-worker.test.ts',
  'src/main/__tests__/tailored-application-session-service.test.ts',
  'src/main/__tests__/vacancy-browser-session-service.test.ts',
  'src/main/__tests__/vacancy-service.test.ts',
];
