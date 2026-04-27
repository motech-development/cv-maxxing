// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { SettingsScreen } from '../settings-screen.js'

afterEach(() => {
  cleanup()
})

const noop = vi.fn()

const settingsSnapshot = {
  appVersion: '1.0.0',
  workerCommand: 'codex',
  workerProvider: 'codex',
} as const

test('formats the connected AI provider and hides recovery actions', () => {
  render(
    <SettingsScreen
      activeSection="ai_worker"
      isClearingJobSiteBrowserData={false}
      isOpeningSetupGuide={false}
      isResettingLocalAppData={false}
      isRetryingAiWorker={false}
      onClearJobSiteBrowserData={noop}
      onOpenSetupGuide={noop}
      onResetLocalAppData={noop}
      onRetryAiWorker={noop}
      onSelectRailItem={noop}
      onSelectSection={noop}
      runtimeAlert={null}
      snapshot={settingsSnapshot}
      workerStatus="ready"
      workerStatusLabel="Connected"
      workerStatusTone="ready"
    />,
  )

  expect(screen.getByText('Using')).toBeDefined()
  expect(screen.getByText('Codex')).toBeDefined()
  expect(screen.queryByText('codex')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Get help' })).toBeNull()
})

test('keeps recovery actions visible when AI settings are not ready', () => {
  render(
    <SettingsScreen
      activeSection="ai_worker"
      isClearingJobSiteBrowserData={false}
      isOpeningSetupGuide={false}
      isResettingLocalAppData={false}
      isRetryingAiWorker={false}
      onClearJobSiteBrowserData={noop}
      onOpenSetupGuide={noop}
      onResetLocalAppData={noop}
      onRetryAiWorker={noop}
      onSelectRailItem={noop}
      onSelectSection={noop}
      runtimeAlert={null}
      snapshot={settingsSnapshot}
      workerStatus="unavailable"
      workerStatusLabel="Needs attention"
      workerStatusTone="danger"
    />,
  )

  expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Get help' })).toBeDefined()
})

test('keeps app version visible without privacy guardrails in Local data settings', () => {
  render(
    <SettingsScreen
      activeSection="local_data"
      isClearingJobSiteBrowserData={false}
      isOpeningSetupGuide={false}
      isResettingLocalAppData={false}
      isRetryingAiWorker={false}
      onClearJobSiteBrowserData={noop}
      onOpenSetupGuide={noop}
      onResetLocalAppData={noop}
      onRetryAiWorker={noop}
      onSelectRailItem={noop}
      onSelectSection={noop}
      runtimeAlert={null}
      snapshot={settingsSnapshot}
      workerStatus="ready"
      workerStatusLabel="Connected"
      workerStatusTone="ready"
    />,
  )

  expect(screen.getByText('App version')).toBeDefined()
  expect(screen.getByText('1.0.0')).toBeDefined()
  expect(screen.queryByText('Privacy guardrails')).toBeNull()
  expect(screen.queryByText('Telemetry')).toBeNull()
  expect(screen.queryByText('Automatic update checks')).toBeNull()
  expect(screen.queryByText('Blocked')).toBeNull()
})
