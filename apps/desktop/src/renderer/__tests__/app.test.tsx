// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { App } from '../app.js'

afterEach(() => {
  cleanup()
})

test('renders the AI worker readiness gate before unlocking the workspace', async () => {
  globalThis.window.cvMaxxing = {
    aiWorker: {
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: false,
        message: 'Checking the local AI worker before opening your workspace.',
        provider: 'codex',
        status: 'checking',
      }),
    },
  }

  render(<App />)

  expect(screen.getByRole('heading', { name: 'AI worker setup' })).toBeDefined()
  expect(screen.getByText('AI worker readiness gate')).toBeDefined()
  expect(screen.getByText('Blocked')).toBeDefined()

  await waitFor(() => {
    expect(globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight).toHaveBeenCalledTimes(1)
  })
})

test('updates the readiness gate when the typed preflight query returns ready', async () => {
  globalThis.window.cvMaxxing = {
    aiWorker: {
      getAiWorkerPreflight: vi.fn().mockResolvedValue({
        canResumeGeneration: true,
        message: 'The local AI worker is ready.',
        provider: 'codex',
        status: 'ready',
      }),
    },
  }

  render(<App />)

  await waitFor(() => {
    expect(screen.getByText('Unlocked')).toBeDefined()
  })

  expect(screen.getByText('The local AI worker is ready.')).toBeDefined()
})

test('renders a blocked startup error when the readiness query fails', async () => {
  globalThis.window.cvMaxxing = {
    aiWorker: {
      getAiWorkerPreflight: vi.fn().mockRejectedValue(new Error('worker crashed')),
    },
  }

  render(<App />)

  await waitFor(() => {
    expect(
      screen.getByText(
        'Unable to complete the AI worker startup check. Restart the app or verify the local AI worker setup.',
      ),
    ).toBeDefined()
  })

  expect(screen.getByText('Blocked')).toBeDefined()
})
