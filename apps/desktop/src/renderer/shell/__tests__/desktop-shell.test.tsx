// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { DesktopShell } from '../desktop-shell.js'

test('renders a full-bleed app shell that aligns with macOS window chrome', () => {
  const { container } = render(
    <DesktopShell
      activeRailItem="setup"
      sidebar={<div>Sidebar</div>}
      subtitle="AI worker setup"
      workerLabel="Checking"
      workerTone="muted"
    >
      <div>Body</div>
    </DesktopShell>,
  )

  const shellRoot = container.querySelector('main')
  const shellFrame = container.querySelector('section')
  const topbar = container.querySelector('header')

  expect(shellRoot).not.toBeNull()
  expect(shellFrame).not.toBeNull()
  expect(topbar).not.toBeNull()

  expect(shellRoot?.className).not.toContain('p-6')
  expect(shellFrame?.className).not.toContain('rounded-[12px]')
  expect(shellFrame?.className).toContain('min-h-screen')
  expect(topbar?.className).toContain('h-[52px]')
  expect(topbar?.className).toContain('pl-[84px]')
  expect(topbar?.className).toContain('pr-[18px]')
  expect(topbar?.className).not.toContain('pt-2')
  expect(container.querySelectorAll('nav svg')).toHaveLength(4)
  expect(screen.queryByText('AI')).toBeNull()
  expect(screen.queryByText('JV')).toBeNull()
  expect(screen.getByText('CV Maxxing')).toBeDefined()
})
