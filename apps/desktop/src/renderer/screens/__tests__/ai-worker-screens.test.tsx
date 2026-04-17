// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import type { ReadinessRouteViewModel } from '../../../readiness/readiness-route.js'
import { AiWorkerCheckingScreen } from '../ai-worker-checking-screen.js'
import { AiWorkerSignInRequiredScreen } from '../ai-worker-sign-in-required-screen.js'
import { AiWorkerUnavailableScreen } from '../ai-worker-unavailable-screen.js'

const baseViewModel: ReadinessRouteViewModel = {
  body: 'AI needs attention before the app can continue.',
  canEnterWorkspace: false,
  diagnostic: "AI isn't available on this Mac yet.",
  heading: 'Connect AI',
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

  expect(screen.getAllByRole('heading', { level: 1, name: 'Connect AI' }).length).toBeGreaterThan(0)

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
        body: 'AI needs you to sign in before CV Maxxing can continue.',
        status: 'sign_in_required',
      }}
    />,
  )

  expect(screen.getAllByRole('heading', { level: 1, name: 'Connect AI' }).length).toBeGreaterThan(0)

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
        body: 'Getting AI ready before you enter the app.',
        diagnostic: undefined,
        status: 'checking',
      }}
    />,
  )

  expect(screen.getByRole('heading', { name: 'Getting AI ready' })).toBeDefined()

  const sidebarContainer = container.querySelector('aside > div')

  expect(sidebarContainer?.className).toContain('w-[328px]')
  expect(sidebarContainer?.className).toContain('border-r')
})
