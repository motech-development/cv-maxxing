import { expect, test } from 'vitest'

import { resolveRendererScreen } from '../renderer-screen.js'

test('falls back to first_launch when no active original CV is available', () => {
  expect(
    resolveRendererScreen({
      originalCvWorkspaceState: {
        activeOriginalCv: null,
        snapshotCount: 0,
      },
      readinessViewModel: {
        body: 'The local AI worker is ready. Returning you to your workspace.',
        canEnterWorkspace: true,
        diagnostic: 'Startup route restored: workspace_empty.',
        heading: 'Workspace restored',
        primaryActionLabel: undefined,
        secondaryActionLabel: undefined,
        startupDestination: 'workspace_empty',
        status: 'ready',
      },
    }),
  ).toBe('first_launch')
})
