// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { WorkspaceBlockingOverlay } from '../workspace-blocking-overlay.js'

afterEach(() => {
  cleanup()
})

test('renders a compact loading spinner with an optional secondary action', () => {
  const onSecondaryAction = vi.fn()

  const { container } = render(
    <WorkspaceBlockingOverlay
      onSecondaryAction={onSecondaryAction}
      secondaryActionLabel="Cancel"
      title="Tailoring your CV..."
    />,
  )

  expect(screen.getByRole('status', { name: 'Tailoring your CV...' })).toBeDefined()
  expect(screen.getByText('Tailoring your CV...')).toBeDefined()
  expect(container.firstElementChild?.className).toContain('bg-[#DEE6E1E8]')
  expect(screen.getByRole('status', { name: 'Tailoring your CV...' }).className).toContain(
    'bg-[#FCFDFC]',
  )
  expect(screen.getByRole('status', { name: 'Tailoring your CV...' }).className).toContain(
    'border-[#C7D0CA]',
  )
  expect(screen.getByRole('button', { name: 'Cancel' }).className).toContain(
    'bg-[var(--color-surface-danger)]',
  )

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(onSecondaryAction).toHaveBeenCalledTimes(1)
})

test('omits the secondary action when none is provided', () => {
  render(<WorkspaceBlockingOverlay />)

  expect(screen.getByText('Getting things ready')).toBeDefined()
  expect(screen.queryByRole('button')).toBeNull()
})
