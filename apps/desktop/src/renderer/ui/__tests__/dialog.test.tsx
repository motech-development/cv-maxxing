// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { RuntimeAlert } from '../../runtime-alerts.js';
import { Dialog } from '../dialog.js';

afterEach(() => {
  cleanup();
});

const dialogRuntimeAlert: RuntimeAlert = {
  body: 'Finish the action already in progress, then try again.',
  owner: {
    scope: 'settings',
    view: 'local_data_reset_dialog',
  },
  priority: 300,
  source: 'dialog_action',
  title: 'This action cannot continue right now.',
  variant: 'error',
};

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
  );

  expect(screen.getByRole('dialog', { name: 'Discard current vacancy draft?' })).toBeDefined();
  expect(
    screen.getByText('Starting a new vacancy will remove the current draft from the workspace.'),
  ).toBeDefined();
  expect(screen.getByRole('button', { name: 'Confirm action' })).toBeDefined();
});

test('renders a shared alert below the title block when provided', () => {
  render(
    <Dialog
      actions={<button type="button">Confirm action</button>}
      isDismissable={false}
      isOpen
      onOpenChange={vi.fn()}
      runtimeAlert={dialogRuntimeAlert}
      title="Reset local app data?"
    >
      <p>Dialog body</p>
    </Dialog>,
  );

  const dialog = screen.getByRole('dialog', { name: 'Reset local app data?' });
  const dialogText = dialog.textContent;

  expect(within(dialog).getByRole('alert')).toBeDefined();
  expect(dialogText.indexOf('Reset local app data?')).toBeLessThan(
    dialogText.indexOf('This action cannot continue right now.'),
  );
  expect(dialogText.indexOf('This action cannot continue right now.')).toBeLessThan(
    dialogText.indexOf('Dialog body'),
  );
});

test('anchors the dialog to the viewport center when open', () => {
  render(
    <Dialog
      actions={<button type="button">Confirm action</button>}
      isDismissable={false}
      isOpen
      onOpenChange={vi.fn()}
      title="Discard current vacancy draft?"
    >
      <p>Dialog body</p>
    </Dialog>,
  );

  const dialog = screen.getByRole('dialog', {
    name: 'Discard current vacancy draft?',
  });

  expect(dialog.className).toContain('fixed');
  expect(dialog.className).toContain('left-1/2');
  expect(dialog.className).toContain('top-1/2');
  expect(dialog.className).toContain('-translate-x-1/2');
  expect(dialog.className).toContain('-translate-y-1/2');
});

test('prevents escape and backdrop dismissal when dismissing is disabled', () => {
  const onOpenChange = vi.fn();

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
  );

  const dialog = screen.getByRole('dialog', {
    name: 'Discard current vacancy draft?',
  });
  const cancelEvent = new Event('cancel', {
    bubbles: false,
    cancelable: true,
  });

  fireEvent(dialog, cancelEvent);
  fireEvent.click(dialog);

  expect(cancelEvent.defaultPrevented).toBe(true);
  expect(onOpenChange).not.toHaveBeenCalled();
});
