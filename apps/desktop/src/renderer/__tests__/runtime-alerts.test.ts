import { expect, test } from 'vitest';

import {
  createRuntimeAlert,
  pickHigherPriorityAlert,
  resolveNextRuntimeAlert,
  resolveRuntimeAlertOwnerKey,
} from '../runtime-alerts.js';

test('creates a structured runtime alert with grouped items', () => {
  const alert = createRuntimeAlert({
    body: 'Fix the issue and try again.',
    items: [
      {
        description: 'Open the current sign-in window.',
        id: 'item-1',
        label: 'Sign-in',
      },
    ],
    owner: {
      scope: 'setup',
      view: 'ai_worker_sign_in_required',
    },
    priority: 200,
    source: 'ai_worker_sign_in',
    title: 'Sign in to continue.',
    variant: 'warning',
  });

  expect(alert.owner.scope).toBe('setup');
  expect(alert.owner.view).toBe('ai_worker_sign_in_required');
  expect(alert.source).toBe('ai_worker_sign_in');
  expect(alert.variant).toBe('warning');
  expect(alert.priority).toBe(200);
  expect(alert.items).toHaveLength(1);
  expect(resolveRuntimeAlertOwnerKey(alert.owner)).toBe('setup:ai_worker_sign_in_required');
});

test('prefers higher-priority unresolved alerts', () => {
  const current = createRuntimeAlert({
    body: 'Do not replace me yet.',
    owner: {
      scope: 'setup',
      view: 'ai_worker_unavailable',
    },
    priority: 300,
    source: 'ai_worker_preflight',
    title: 'Current',
    variant: 'error',
  });
  const next = createRuntimeAlert({
    body: 'Lower priority alert.',
    owner: {
      scope: 'setup',
      view: 'ai_worker_unavailable',
    },
    priority: 200,
    source: 'ai_worker_secondary_action',
    title: 'Next',
    variant: 'warning',
  });

  expect(pickHigherPriorityAlert(current, next)).toBe(current);
});

test('keeps the current alert when the next alert is equivalent', () => {
  const current = createRuntimeAlert({
    body: 'Check the current field and try again.',
    items: [
      {
        description: 'Add the full job description.',
        id: 'job-description',
        label: 'Job description',
      },
    ],
    owner: {
      scope: 'job_vacancies',
      view: 'draft',
    },
    priority: 300,
    source: 'draft_validation',
    title: 'Add a bit more detail before tailoring your CV.',
    variant: 'warning',
  });
  const next = createRuntimeAlert({
    body: 'Check the current field and try again.',
    items: [
      {
        description: 'Add the full job description.',
        id: 'job-description',
        label: 'Job description',
      },
    ],
    owner: {
      scope: 'job_vacancies',
      view: 'draft',
    },
    priority: 300,
    source: 'draft_validation',
    title: 'Add a bit more detail before tailoring your CV.',
    variant: 'warning',
  });

  expect(resolveNextRuntimeAlert(current, next)).toBe(current);
});
