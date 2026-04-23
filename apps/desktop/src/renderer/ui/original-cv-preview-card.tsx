import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'

import type { OriginalCvDocxPreview, OriginalCvPreview } from '../../shared/original-cv.js'
import { PdfPreviewCard } from './pdf-preview-card.js'

interface OriginalCvPreviewCardProperties {
  emptyStateCopy: string
  onPreviewErrorChange?: (message: string | null) => void
  preview: OriginalCvPreview | null
  previewKey: string
  title: string
}

const DOCX_PREVIEW_CLASS_NAME = 'cv-maxxing-docx'

const DOCX_RENDER_OPTIONS = {
  breakPages: true,
  className: DOCX_PREVIEW_CLASS_NAME,
  inWrapper: true,
  useBase64URL: true,
} as const

export function OriginalCvPreviewCard({
  emptyStateCopy,
  onPreviewErrorChange,
  preview,
  previewKey,
  title,
}: OriginalCvPreviewCardProperties) {
  if (preview === null || preview.kind === 'pdf') {
    return (
      <PdfPreviewCard
        emptyStateCopy={emptyStateCopy}
        preview={preview}
        previewKey={previewKey}
        title={title}
      />
    )
  }

  return (
    <LoadedDocxPreviewCard
      key={previewKey}
      onPreviewErrorChange={onPreviewErrorChange}
      preview={preview}
      title={title}
    />
  )
}

function LoadedDocxPreviewCard({
  onPreviewErrorChange,
  preview,
  title,
}: {
  onPreviewErrorChange?: (message: string | null) => void
  preview: OriginalCvDocxPreview
  title: string
}) {
  const bodyContainerReference = useRef<HTMLDivElement | null>(null)
  const styleContainerReference = useRef<HTMLDivElement | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    const bodyContainer = bodyContainerReference.current
    const styleContainer = styleContainerReference.current

    if (bodyContainer === null || styleContainer === null) {
      return
    }

    const resolvedBodyContainer = bodyContainer
    const resolvedStyleContainer = styleContainer
    let isCancelled = false

    resolvedBodyContainer.replaceChildren()
    resolvedStyleContainer.replaceChildren()

    async function renderDocxPreview(): Promise<void> {
      try {
        await renderAsync(
          Uint8Array.from(preview.docxBytes),
          resolvedBodyContainer,
          resolvedStyleContainer,
          DOCX_RENDER_OPTIONS,
        )

        if (isCancelled) {
          resolvedBodyContainer.replaceChildren()
          resolvedStyleContainer.replaceChildren()

          return
        }

        setRenderError((previousError) => {
          return previousError === null ? previousError : null
        })
      } catch (error) {
        resolvedBodyContainer.replaceChildren()
        resolvedStyleContainer.replaceChildren()

        if (isCancelled) {
          return
        }

        setRenderError(
          error instanceof Error ? error.message : "We couldn't show this document right now.",
        )
      }
    }

    renderDocxPreview().catch(() => {
      if (isCancelled) {
        return
      }

      setRenderError("We couldn't show this document right now.")
    })

    return () => {
      isCancelled = true
      resolvedBodyContainer.replaceChildren()
      resolvedStyleContainer.replaceChildren()
    }
  }, [preview])

  useEffect(() => {
    onPreviewErrorChange?.(renderError)
  }, [onPreviewErrorChange, renderError])

  return (
    <div className="flex h-full min-h-[520px] min-w-0 max-w-full flex-col gap-4 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-[18px]">
      <div className="min-h-0 min-w-0 max-w-full flex-1 overflow-hidden rounded-[6px] bg-[var(--color-shell-canvas)] p-4">
        <div
          aria-label={`${title} DOCX preview`}
          className={`${renderError ? 'hidden' : 'block'} h-full w-full overflow-auto`}
        >
          <div className="min-h-full min-w-full" ref={styleContainerReference} />
          <div className="min-h-full min-w-full" ref={bodyContainerReference} />
        </div>
      </div>
    </div>
  )
}
