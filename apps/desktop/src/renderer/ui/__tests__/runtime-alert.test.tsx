// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import type { RuntimeAlert } from '../../runtime-alerts.js';
import { RuntimeAlertBanner } from '../runtime-alert.js';

afterEach(() => {
  cleanup();
});

function createAlert(overrides: Partial<RuntimeAlert> = {}): RuntimeAlert {
  return {
    body: 'Finish the step already in progress, then try again.',
    owner: {
      scope: 'setup',
      view: 'ai_worker_unavailable',
    },
    priority: 300,
    source: 'ai_worker_preflight',
    title: 'AI is not ready on this Mac.',
    variant: 'error',
    ...overrides,
  };
}

test('renders error alerts with assertive semantics', () => {
  render(<RuntimeAlertBanner alert={createAlert()} />);

  const alert = screen.getByRole('alert');

  expect(alert.getAttribute('aria-live')).toBe('assertive');
  expect(alert.getAttribute('aria-atomic')).toBe('true');
  expect(alert.className).toContain('w-full');
  expect(alert.className).not.toContain('max-w-4xl');
  expect(screen.getByText('Needs attention')).toBeDefined();
  expect(screen.getByText('AI is not ready on this Mac.')).toBeDefined();
});

test('renders warning alerts with polite semantics and grouped items', () => {
  render(
    <RuntimeAlertBanner
      alert={createAlert({
        items: [
          {
            description: 'Use the latest sign-in window on this Mac.',
            id: 'sign-in-window',
            label: 'Sign-in',
          },
        ],
        title: undefined,
        variant: 'warning',
      })}
    />,
  );

  const alert = screen.getByRole('status');

  expect(alert.getAttribute('aria-live')).toBe('polite');
  expect(screen.getByText('Needs attention')).toBeDefined();
  expect(screen.getByText('Use the latest sign-in window on this Mac.')).toBeDefined();
  expect(screen.getByText('Sign-in')).toBeDefined();
});

test('focuses the targeted field when an alert item is activated', () => {
  render(
    <>
      <input aria-label="Job description" id="workspace-vacancy-text" type="text" />
      <RuntimeAlertBanner
        alert={createAlert({
          items: [
            {
              description: 'Add more detail before tailoring your CV.',
              id: 'job-description',
              label: 'Job description',
              targetId: 'workspace-vacancy-text',
            },
          ],
          title: 'Add a bit more detail before tailoring your CV.',
          variant: 'warning',
        })}
      />
    </>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Job description' }));

  expect(screen.getByLabelText('Job description')).toBe(globalThis.document.activeElement);
});
