// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { WorkspaceBlockingOverlay } from '../workspace-blocking-overlay.js'

afterEach(() => {
  cleanup()
})

test('renders neutral workspace-loading copy with an optional secondary action', () => {
  const onSecondaryAction = vi.fn()

  render(
    <WorkspaceBlockingOverlay
      onSecondaryAction={onSecondaryAction}
      secondaryActionLabel="Abandon draft"
    />,
  )

  expect(screen.getByRole('status', { name: 'Loading workspace' })).toBeDefined()
  expect(
    screen.getByText('This workspace is temporarily blocked while the current task completes.'),
  ).toBeDefined()

  fireEvent.click(screen.getByRole('button', { name: 'Abandon draft' }))

  expect(onSecondaryAction).toHaveBeenCalledTimes(1)
})

test('omits the secondary action when none is provided', () => {
  render(<WorkspaceBlockingOverlay />)

  expect(screen.queryByRole('button')).toBeNull()
})
