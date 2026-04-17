// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import type { ReadinessRouteViewModel } from '../../../readiness/readiness-route.js'
import { AiWorkerCheckingScreen } from '../ai-worker-checking-screen.js'
import { AiWorkerSignInRequiredScreen } from '../ai-worker-sign-in-required-screen.js'
import { AiWorkerUnavailableScreen } from '../ai-worker-unavailable-screen.js'

const baseViewModel: ReadinessRouteViewModel = {
  body: 'The local AI worker needs attention before the workspace can open.',
  canEnterWorkspace: false,
  diagnostic: 'Codex CLI was not found on this machine.',
  heading: 'AI worker setup',
  status: 'unavailable',
}

test('renders the unavailable AI worker sidebar inside the shared shell container', () => {
  const { container } = render(
    <AiWorkerUnavailableScreen
      isPrimaryActionPending={false}
      isSecondaryActionPending={false}
      onPrimaryAction={vi.fn()}
      onSecondaryAction={vi.fn()}
      readinessError={null}
      viewModel={baseViewModel}
    />,
  )

  expect(screen.getByRole('heading', { name: 'Repair the local AI worker' })).toBeDefined()

  const sidebarContainer = container.querySelector('aside > div')

  expect(sidebarContainer?.className).toContain('w-[328px]')
  expect(sidebarContainer?.className).toContain('border-r')
})

test('renders the sign-in-required AI worker sidebar inside the shared shell container', () => {
  const { container } = render(
    <AiWorkerSignInRequiredScreen
      isPrimaryActionPending={false}
      isSecondaryActionPending={false}
      onPrimaryAction={vi.fn()}
      onSecondaryAction={vi.fn()}
      readinessError={null}
      viewModel={{
        ...baseViewModel,
        body: 'The local CLI session must be authenticated before generation can begin.',
        status: 'sign_in_required',
      }}
    />,
  )

  expect(screen.getByRole('heading', { name: 'Connect the local AI worker' })).toBeDefined()

  const sidebarContainer = container.querySelector('aside > div')

  expect(sidebarContainer?.className).toContain('w-[328px]')
  expect(sidebarContainer?.className).toContain('border-r')
})

test('renders the checking AI worker sidebar inside the shared shell container', () => {
  const { container } = render(
    <AiWorkerCheckingScreen
      onOpenSetupGuide={vi.fn()}
      readinessError={null}
      viewModel={{
        ...baseViewModel,
        body: 'Checking the local AI worker before opening the workspace.',
        diagnostic: undefined,
        status: 'checking',
      }}
    />,
  )

  expect(screen.getByRole('heading', { name: 'Checking the local AI worker' })).toBeDefined()

  const sidebarContainer = container.querySelector('aside > div')

  expect(sidebarContainer?.className).toContain('w-[328px]')
  expect(sidebarContainer?.className).toContain('border-r')
})
