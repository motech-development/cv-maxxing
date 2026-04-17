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
        body: 'AI is ready. Opening your jobs.',
        canEnterWorkspace: true,
        diagnostic: 'Startup route restored: workspace.',
        heading: 'Workspace restored',
        primaryActionLabel: undefined,
        secondaryActionLabel: undefined,
        startupDestination: 'workspace',
        status: 'ready',
      },
    }),
  ).toBe('first_launch')
})

test('resolves the post-import workspace to a single screen when an original CV is active', () => {
  expect(
    resolveRendererScreen({
      originalCvWorkspaceState: {
        activeOriginalCv: {
          fileType: 'pdf',
          headline: 'Principal Product Designer',
          id: 'original-cv-123',
          importedAt: '2026-04-08T14:30:00.000Z',
          originalFilename: 'ada-lovelace.pdf',
          pageCount: 1,
          snapshotCount: 1,
          summary: 'Design leader focused on complex workflow products.',
          writingStyle: {
            averageSentenceLength: 7,
            clicheDetections: [],
            firstPersonUsage: 'absent',
            formality: 'direct',
          },
        },
        snapshotCount: 1,
      },
      readinessViewModel: {
        body: 'AI is ready. Opening your jobs.',
        canEnterWorkspace: true,
        diagnostic: 'Startup route restored: workspace.',
        heading: 'Workspace restored',
        primaryActionLabel: undefined,
        secondaryActionLabel: undefined,
        startupDestination: 'workspace',
        status: 'ready',
      },
    }),
  ).toBe('workspace')
})
