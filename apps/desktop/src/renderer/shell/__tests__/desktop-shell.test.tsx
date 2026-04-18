// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { DesktopShell } from '../desktop-shell.js'
import { SidebarContainer } from '../sidebar-container.js'

afterEach(() => {
  cleanup()
})

test('renders a full-bleed app shell that aligns with macOS window chrome', () => {
  const { container } = render(
    <DesktopShell
      activeRailItem="setup"
      railItems={['setup']}
      sidebar={
        <SidebarContainer>
          <div>Sidebar</div>
        </SidebarContainer>
      }
      subtitle="Connect AI"
      statusPill={{
        label: 'Checking',
        tone: 'muted',
      }}
    >
      <div>Body</div>
    </DesktopShell>,
  )

  const shellRoot = container.querySelector('main')
  const shellFrame = container.querySelector('section')
  const topbar = container.querySelector('header')
  const rail = container.querySelector('nav')
  const sidebar = container.querySelector('aside')
  const sidebarContainer = sidebar?.firstElementChild
  const contentPane = sidebar?.nextElementSibling

  expect(shellRoot).not.toBeNull()
  expect(shellFrame).not.toBeNull()
  expect(topbar).not.toBeNull()
  expect(rail).not.toBeNull()
  expect(sidebar).not.toBeNull()
  expect(sidebarContainer).not.toBeNull()
  expect(contentPane).not.toBeNull()

  expect(shellRoot?.className).not.toContain('p-6')
  expect(shellRoot?.className).toContain('h-screen')
  expect(shellRoot?.className).not.toContain('min-h-screen')
  expect(shellFrame?.className).not.toContain('rounded-[12px]')
  expect(shellFrame?.className).toContain('h-screen')
  expect(shellFrame?.className).not.toContain('min-h-screen')
  expect(topbar?.className).toContain('h-[52px]')
  expect(topbar?.className).toContain('pl-[100px]')
  expect(topbar?.className).toContain('pr-[18px]')
  expect(topbar?.className).not.toContain('pt-2')
  expect(rail?.className).toContain('w-20')
  expect(sidebar?.className).toContain('min-h-0')
  expect(contentPane?.className).toContain('overflow-y-auto')
  expect(container.querySelectorAll('nav svg')).toHaveLength(1)
  expect(screen.getByText('AI')).toBeDefined()
  expect(screen.queryByText('JV')).toBeNull()
  expect(screen.getByText('CV Maxxing')).toBeDefined()
})

test('hides persistent AI status and subtitles in the normal connected shell', () => {
  render(
    <DesktopShell
      activeRailItem="job_vacancies"
      ambientActivityLabel="Background activity"
      railItems={['job_vacancies', 'original_cv', 'settings']}
      sidebar={
        <SidebarContainer>
          <div>Sidebar</div>
        </SidebarContainer>
      }
    >
      <div>Body</div>
    </DesktopShell>,
  )

  expect(screen.getByRole('status', { name: 'Background activity' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Jobs' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Your CV' })).toBeDefined()
  expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined()
  expect(screen.queryByRole('button', { name: 'AI' })).toBeNull()
  expect(screen.getByText('Jobs')).toBeDefined()
  expect(screen.getByText('Your CV')).toBeDefined()
  expect(screen.getByText('Settings')).toBeDefined()
  expect(screen.queryByText('Workspace')).toBeNull()
  expect(screen.queryByText('Local')).toBeNull()
  expect(screen.queryByText('Background activity')).toBeNull()
})
