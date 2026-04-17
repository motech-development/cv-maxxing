import { LoaderCircle } from 'lucide-react'

import { Button } from '../ui/button.js'
import { PanelCard } from '../ui/panel-card.js'

interface WorkspaceBlockingOverlayProperties {
  isSecondaryActionPending?: boolean
  onSecondaryAction?: () => void
  secondaryActionLabel?: string
  title?: string
}

const defaultOverlayTitle = 'Getting things ready'

export function WorkspaceBlockingOverlay({
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
    <div className="flex h-full w-full items-center justify-center bg-[#DEE6E1E8] p-6">
      <PanelCard
        aria-label={title}
        className={`flex flex-col items-center justify-center bg-[#FCFDFC] shadow-[0_8px_24px_rgba(30,36,40,0.10)] ${
          hasSecondaryAction
            ? 'w-[216px] gap-4 rounded-[14px] border-[#C7D0CA] px-5 py-5'
            : 'w-[216px] gap-3 rounded-[14px] border-[#C7D0CA] px-5 py-5'
        }`}
        role="status"
      >
        <LoaderCircle
          aria-hidden="true"
          className="h-7 w-7 animate-[spin_2.4s_linear_infinite] text-[#74827B]"
          strokeWidth={2.1}
        />
        <p className="m-0 text-center text-[13px] font-extrabold text-[var(--color-copy-strong)]">
          {title}
        </p>
        {hasSecondaryAction ? (
          <Button disabled={isSecondaryActionPending} onClick={onSecondaryAction} tone="danger">
            {secondaryActionLabel}
          </Button>
        ) : null}
      </PanelCard>
    </div>
  )
}
