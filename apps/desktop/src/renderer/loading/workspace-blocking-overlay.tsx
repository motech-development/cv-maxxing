import { LoaderCircle } from 'lucide-react'

import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'

interface WorkspaceBlockingOverlayProperties {
  body?: string
  isSecondaryActionPending?: boolean
  onSecondaryAction?: () => void
  secondaryActionLabel?: string
  title?: string
}

const defaultOverlayTitle = 'Loading workspace'
const defaultOverlayBody = 'This workspace is temporarily blocked while the current task completes.'

export function WorkspaceBlockingOverlay({
  body = defaultOverlayBody,
  isSecondaryActionPending = false,
  onSecondaryAction,
  secondaryActionLabel,
  title = defaultOverlayTitle,
}: WorkspaceBlockingOverlayProperties) {
  const hasSecondaryAction =
    secondaryActionLabel !== undefined &&
    secondaryActionLabel !== '' &&
    onSecondaryAction !== undefined

  return (
    <div className="flex h-full w-full items-center justify-center bg-[#F4F6F3CC] p-6">
      <PanelCard
        aria-label={title}
        className="flex w-full max-w-[360px] flex-col items-center gap-4 bg-white px-6 py-7 text-center shadow-[0_8px_24px_rgba(30,36,40,0.07)]"
        role="status"
      >
        <LoaderCircle
          aria-hidden="true"
          className="h-7 w-7 animate-[spin_2.4s_linear_infinite] text-[var(--color-copy-subtle)]"
          strokeWidth={2.1}
        />
        <div className="flex flex-col gap-2">
          <p className="m-0 text-sm font-extrabold text-[var(--color-copy-strong)]">{title}</p>
          <p className="m-0 text-sm leading-6 text-[var(--color-copy-muted)]">{body}</p>
        </div>
        {hasSecondaryAction ? (
          <Button disabled={isSecondaryActionPending} onClick={onSecondaryAction} tone="secondary">
            {secondaryActionLabel}
          </Button>
        ) : null}
      </PanelCard>
    </div>
  )
}
