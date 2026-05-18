// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { DesktopShell } from '../desktop-shell.js';
import { SidebarContainer } from '../sidebar-container.js';

afterEach(() => {
  cleanup();
});

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
  );

  const shellRoot = container.querySelector('main');
  const shellFrame = container.querySelector('section');
  const topbar = container.querySelector('header');
  const rail = container.querySelector('nav');
  const sidebar = container.querySelector('aside');
  const sidebarContainer = sidebar?.firstElementChild;
  const contentPane = sidebar?.nextElementSibling;

  expect(shellRoot).not.toBeNull();
  expect(shellFrame).not.toBeNull();
  expect(topbar).not.toBeNull();
  expect(rail).not.toBeNull();
  expect(sidebar).not.toBeNull();
  expect(sidebarContainer).not.toBeNull();
  expect(contentPane).not.toBeNull();

  expect(shellRoot?.className).not.toContain('p-6');
  expect(shellRoot?.className).toContain('h-screen');
  expect(shellRoot?.className).not.toContain('min-h-screen');
  expect(shellFrame?.className).not.toContain('rounded-[12px]');
  expect(shellFrame?.className).toContain('h-screen');
  expect(shellFrame?.className).not.toContain('min-h-screen');
  expect(topbar?.className).toContain('h-[52px]');
  expect(topbar?.className).toContain('pl-[100px]');
  expect(topbar?.className).toContain('pr-[18px]');
  expect(topbar?.className).not.toContain('pt-2');
  expect(rail?.className).toContain('w-20');
  expect(sidebar?.className).toContain('min-h-0');
  expect(contentPane?.className).toContain('overflow-y-auto');
  expect(container.querySelectorAll('nav svg')).toHaveLength(1);
  expect(screen.getByText('AI')).toBeDefined();
  expect(screen.queryByText('JV')).toBeNull();
  expect(screen.getByText('CV Maxxing')).toBeDefined();
});

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
  );

  expect(screen.getByRole('status', { name: 'Background activity' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Jobs' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Your CV' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Settings' })).toBeDefined();
  expect(screen.queryByRole('button', { name: 'AI' })).toBeNull();
  expect(screen.getByText('Jobs')).toBeDefined();
  expect(screen.getByText('Your CV')).toBeDefined();
  expect(screen.getByText('Settings')).toBeDefined();
  expect(screen.queryByText('Workspace')).toBeNull();
  expect(screen.queryByText('Local')).toBeNull();
  expect(screen.queryByText('Background activity')).toBeNull();
});

test('renders the standard page-top alert slot below the page title and intro copy', () => {
  const { container } = render(
    <DesktopShell
      activeRailItem="setup"
      pageAlert={<div data-testid="page-alert">Shared alert</div>}
      pageIntro="Intro copy"
      pageTitle="Page title"
      railItems={['setup']}
      sidebar={
        <SidebarContainer>
          <div>Sidebar</div>
        </SidebarContainer>
      }
    >
      <div data-testid="page-body">Body</div>
    </DesktopShell>,
  );

  const contentPane = container.querySelector('aside + div');
  const pageAlert = screen.getByTestId('page-alert');
  const pageAlertSlot = pageAlert.parentElement;
  const pageBody = screen.getByTestId('page-body').parentElement;
  const contentText = contentPane?.textContent ?? '';

  expect(contentText).toContain('Page title');
  expect(contentText).toContain('Intro copy');
  expect(contentText).toContain('Shared alert');
  expect(contentText).toContain('Body');
  expect(contentText.indexOf('Page title')).toBeLessThan(contentText.indexOf('Intro copy'));
  expect(contentText.indexOf('Intro copy')).toBeLessThan(contentText.indexOf('Shared alert'));
  expect(contentText.indexOf('Shared alert')).toBeLessThan(contentText.indexOf('Body'));
  expect(pageAlertSlot?.className).toContain('w-full');
  expect(pageAlertSlot?.className).toContain('self-stretch');
  expect(pageBody?.className).toContain('w-full');
});
