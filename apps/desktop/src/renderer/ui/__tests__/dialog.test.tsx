// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { Dialog } from '../dialog.js'

afterEach(() => {
  cleanup()
})

test('renders titled dialog content with arbitrary body and action content when open', () => {
  render(
    <Dialog
      actions={<button type="button">Confirm action</button>}
      isDismissable={false}
      isOpen
      onOpenChange={vi.fn()}
      title="Discard current vacancy draft?"
    >
      <p>Starting a new vacancy will remove the current draft from the workspace.</p>
    </Dialog>,
  )

  expect(screen.getByRole('dialog', { name: 'Discard current vacancy draft?' })).toBeDefined()
  expect(
    screen.getByText('Starting a new vacancy will remove the current draft from the workspace.'),
  ).toBeDefined()
  expect(screen.getByRole('button', { name: 'Confirm action' })).toBeDefined()
})

test('prevents escape and backdrop dismissal when dismissing is disabled', () => {
  const onOpenChange = vi.fn()

  render(
    <Dialog
      actions={<button type="button">Keep draft</button>}
      isDismissable={false}
      isOpen
      onOpenChange={onOpenChange}
      title="Discard current vacancy draft?"
    >
      <p>Dialog body</p>
    </Dialog>,
  )

  const dialog = screen.getByRole('dialog', {
    name: 'Discard current vacancy draft?',
  })
  const cancelEvent = new Event('cancel', {
    bubbles: false,
    cancelable: true,
  })

  fireEvent(dialog, cancelEvent)
  fireEvent.click(dialog)

  expect(cancelEvent.defaultPrevented).toBe(true)
  expect(onOpenChange).not.toHaveBeenCalled()
})
