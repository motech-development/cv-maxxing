import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'

export type RuntimeAlertScope = 'job_vacancies' | 'original_cv' | 'settings' | 'setup'
export type RuntimeAlertVariant = 'error' | 'info' | 'success' | 'warning'
export type SetupRuntimeAlertView =
  | 'ai_worker_checking'
  | 'ai_worker_sign_in_required'
  | 'ai_worker_unavailable'

export interface RuntimeAlertOwner {
  scope: RuntimeAlertScope
  view: string
}

export interface RuntimeAlertItem {
  description?: string
  id: string
  label?: string
}

export interface RuntimeAlert {
  body?: string
  items?: RuntimeAlertItem[]
  owner: RuntimeAlertOwner
  priority: number
  source: string
  title?: string
  variant: RuntimeAlertVariant
}

interface SetupRuntimeAlertInput {
  body: string
  priority: number
  source: string
  status: AiWorkerPreflightResult['status']
  title: string
  variant: RuntimeAlertVariant
}

interface SetupStatusRuntimeAlertInput {
  body: string
  diagnostic?: string
  status: AiWorkerPreflightResult['status']
}

export function createRuntimeAlert(alert: RuntimeAlert): RuntimeAlert {
  return {
    ...alert,
    items: alert.items?.map((item) => {
      return {
        ...item,
      }
    }),
    owner: {
      ...alert.owner,
    },
  }
}

export function resolveRuntimeAlertOwnerKey(owner: RuntimeAlertOwner): string {
  return `${owner.scope}:${owner.view}`
}

export function pickHigherPriorityAlert(
  currentAlert: RuntimeAlert | null,
  nextAlert: RuntimeAlert | null,
): RuntimeAlert | null {
  if (currentAlert === null) {
    return nextAlert
  }

  if (nextAlert === null) {
    return currentAlert
  }

  if (nextAlert.priority > currentAlert.priority) {
    return nextAlert
  }

  return currentAlert
}

export function createSetupActionRuntimeAlert({
  body,
  priority,
  source,
  status,
  title,
  variant,
}: SetupRuntimeAlertInput): RuntimeAlert {
  return createRuntimeAlert({
    body,
    owner: {
      scope: 'setup',
      view: resolveSetupRuntimeAlertView(status),
    },
    priority,
    source,
    title,
    variant,
  })
}

export function createSetupStatusRuntimeAlert({
  body,
  diagnostic,
  status,
}: SetupStatusRuntimeAlertInput): RuntimeAlert | null {
  if (status === 'checking' || status === 'ready') {
    return null
  }

  const variant = status === 'sign_in_required' ? 'warning' : 'error'
  const title =
    diagnostic ?? (status === 'sign_in_required' ? 'Sign in to continue.' : 'AI needs attention.')

  return createSetupActionRuntimeAlert({
    body,
    priority: status === 'sign_in_required' ? 200 : 300,
    source: 'ai_worker_preflight',
    status,
    title,
    variant,
  })
}

export function getRuntimeAlertLiveRegionProperties(variant: RuntimeAlertVariant): {
  'aria-atomic': 'true'
  'aria-live': 'assertive' | 'polite'
  role: 'alert' | 'status'
} {
  if (variant === 'error') {
    return {
      'aria-atomic': 'true',
      'aria-live': 'assertive',
      role: 'alert',
    }
  }

  return {
    'aria-atomic': 'true',
    'aria-live': 'polite',
    role: 'status',
  }
}

export function resolveRuntimeAlertLabel(variant: RuntimeAlertVariant): string {
  if (variant === 'success') {
    return 'Ready'
  }

  if (variant === 'info') {
    return 'In progress'
  }

  return 'Needs attention'
}

function resolveSetupRuntimeAlertView(
  status: AiWorkerPreflightResult['status'],
): SetupRuntimeAlertView {
  if (status === 'sign_in_required') {
    return 'ai_worker_sign_in_required'
  }

  if (status === 'unavailable') {
    return 'ai_worker_unavailable'
  }

  return 'ai_worker_checking'
}
