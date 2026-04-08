import { useEffect, useState, type ChangeEvent } from 'react'

import { createReadinessRouteViewModel } from '../readiness/readiness-route.js'
import type { ReadinessRouteViewModel } from '../readiness/readiness-route.js'
import type { OriginalCvWorkspaceState } from '../shared/original-cv.js'

const initialReadinessViewModel: ReadinessRouteViewModel = {
  body: 'Checking the local AI worker before opening your workspace.',
  canEnterWorkspace: false,
  diagnostic: 'Looking for the configured local worker, authentication state, and health probe.',
  heading: 'AI worker setup',
  primaryActionLabel: undefined,
  secondaryActionLabel: undefined,
  startupDestination: undefined,
  status: 'checking',
}

const initialOriginalCvWorkspaceState: OriginalCvWorkspaceState = {
  activeOriginalCv: null,
  snapshotCount: 0,
}

const readinessErrorMessage = 'Unable to complete the AI worker startup check.'
const readinessErrorAction = 'Restart the app or verify the local AI worker setup.'

function StatusBadge({ status }: { status: ReadinessRouteViewModel['status'] }) {
  const statusCopy = {
    checking: 'Checking',
    ready: 'Ready',
    sign_in_required: 'Sign in required',
    unavailable: 'Unavailable',
  } as const

  return (
    <span className="rounded-full border border-[var(--color-panel-border)] bg-[var(--color-panel-accent-soft)] px-3 py-1 text-xs uppercase tracking-[0.12em] text-[var(--color-panel-accent)]">
      {statusCopy[status]}
    </span>
  )
}

function getStartupRouteLabel(viewModel: ReadinessRouteViewModel): string {
  if (viewModel.startupDestination === 'workspace_active') {
    return 'Workspace active'
  }

  if (viewModel.startupDestination === 'workspace_empty') {
    return 'Workspace empty'
  }

  if (viewModel.startupDestination === 'workspace_loading') {
    return 'Workspace loading'
  }

  if (viewModel.startupDestination === 'first_launch') {
    return 'First launch'
  }

  return 'AI worker readiness gate'
}

type AppRoute = 'original_cv_workspace' | 'readiness'

export function App() {
  const [currentRoute, setCurrentRoute] = useState<AppRoute>('readiness')
  const [importError, setImportError] = useState<string | null>(null)
  const [isImportingOriginalCv, setIsImportingOriginalCv] = useState(false)
  const [isSecondaryActionPending, setIsSecondaryActionPending] = useState(false)
  const [isSubmittingPrimaryAction, setIsSubmittingPrimaryAction] = useState(false)
  const [originalCvFile, setOriginalCvFile] = useState<File | null>(null)
  const [originalCvWorkspaceState, setOriginalCvWorkspaceState] = useState(
    initialOriginalCvWorkspaceState,
  )
  const [readinessError, setReadinessError] = useState<string | null>(null)
  const [viewModel, setViewModel] = useState(initialReadinessViewModel)

  const loadOriginalCvWorkspace = async (): Promise<void> => {
    const nextWorkspaceState =
      await globalThis.window.cvMaxxing.originalCv.getOriginalCvWorkspaceState()

    setOriginalCvWorkspaceState(nextWorkspaceState)
    setCurrentRoute('original_cv_workspace')
  }

  const loadReadinessState = async (
    getAiWorkerPreflight: typeof globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight,
  ): Promise<void> => {
    const nextViewModel = await createReadinessRouteViewModel({
      getAiWorkerPreflight,
      getStartupDestination: globalThis.window.cvMaxxing.aiWorker.getStartupDestination,
    })

    setReadinessError(null)
    setViewModel(nextViewModel)

    if (
      nextViewModel.canEnterWorkspace &&
      (nextViewModel.startupDestination === 'first_launch' ||
        nextViewModel.startupDestination === 'workspace_empty')
    ) {
      await loadOriginalCvWorkspace()

      return
    }

    setCurrentRoute('readiness')
  }

  useEffect(() => {
    const loadInitialState = async (): Promise<void> => {
      const nextViewModel = await createReadinessRouteViewModel({
        getAiWorkerPreflight: globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight,
        getStartupDestination: globalThis.window.cvMaxxing.aiWorker.getStartupDestination,
      })

      setReadinessError(null)
      setViewModel(nextViewModel)

      if (
        nextViewModel.canEnterWorkspace &&
        (nextViewModel.startupDestination === 'first_launch' ||
          nextViewModel.startupDestination === 'workspace_empty')
      ) {
        const nextWorkspaceState =
          await globalThis.window.cvMaxxing.originalCv.getOriginalCvWorkspaceState()

        setOriginalCvWorkspaceState(nextWorkspaceState)
        setCurrentRoute('original_cv_workspace')

        return
      }

      setCurrentRoute('readiness')
    }

    loadInitialState().catch(() => {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    })
  }, [])

  const handlePrimaryAction = async (): Promise<void> => {
    if (viewModel.primaryActionLabel === undefined || isSubmittingPrimaryAction) {
      return
    }

    const getAiWorkerPreflight =
      viewModel.status === 'sign_in_required'
        ? globalThis.window.cvMaxxing.aiWorker.startAiWorkerSignIn
        : globalThis.window.cvMaxxing.aiWorker.retryAiWorkerPreflight

    setIsSubmittingPrimaryAction(true)

    try {
      await loadReadinessState(getAiWorkerPreflight)
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    } finally {
      setIsSubmittingPrimaryAction(false)
    }
  }

  const handleSecondaryAction = async (): Promise<void> => {
    if (viewModel.secondaryActionLabel === undefined || isSecondaryActionPending) {
      return
    }

    setIsSecondaryActionPending(true)

    try {
      await globalThis.window.cvMaxxing.aiWorker.openAiWorkerSetupGuide()
    } catch {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    } finally {
      setIsSecondaryActionPending(false)
    }
  }

  const handleOriginalCvImport = async (): Promise<void> => {
    if (originalCvFile === null || isImportingOriginalCv) {
      return
    }

    setIsImportingOriginalCv(true)
    setImportError(null)

    try {
      const importResult = await globalThis.window.cvMaxxing.originalCv.importOriginalCv({
        content: new Uint8Array(await originalCvFile.arrayBuffer()),
        filename: originalCvFile.name,
      })

      if (importResult.kind === 'rejected') {
        setImportError(importResult.error.message)

        return
      }

      setOriginalCvFile(null)
      setOriginalCvWorkspaceState({
        activeOriginalCv: importResult.originalCv,
        snapshotCount: importResult.originalCv.snapshotCount,
      })
      setViewModel((previousViewModel) => {
        return {
          ...previousViewModel,
          startupDestination: 'workspace_empty',
        }
      })
    } finally {
      setIsImportingOriginalCv(false)
    }
  }

  const handleOriginalCvSelection = (event: ChangeEvent<HTMLInputElement>): void => {
    setImportError(null)
    setOriginalCvFile(event.target.files?.[0] ?? null)
  }

  const handlePrimaryActionClick = (): void => {
    handlePrimaryAction().catch(() => null)
  }

  const handleSecondaryActionClick = (): void => {
    handleSecondaryAction().catch(() => null)
  }

  const handleOriginalCvImportClick = (): void => {
    handleOriginalCvImport().catch(() => null)
  }

  if (currentRoute === 'original_cv_workspace') {
    const activeOriginalCv = originalCvWorkspaceState.activeOriginalCv
    const isReplacingOriginalCv = activeOriginalCv !== null
    let importActionLabel = 'Import original CV'

    if (isReplacingOriginalCv) {
      importActionLabel = 'Replace original CV'
    }

    if (isImportingOriginalCv) {
      importActionLabel = 'Importing original CV...'
    }

    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-10">
        <section className="grid w-full max-w-6xl gap-8 rounded-[8px] border border-[var(--color-panel-border)] bg-[var(--color-panel-background)]/90 p-8 shadow-[0_24px_80px_rgb(0_0_0_/_0.28)] backdrop-blur xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)]">
          <div className="space-y-8">
            <div className="flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-[var(--color-panel-accent)]" />
              <p className="m-0 text-sm uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
                CV Maxxing
              </p>
            </div>

            <div className="space-y-5">
              <StatusBadge status="ready" />
              <h1 className="m-0 max-w-2xl text-5xl leading-tight text-[var(--color-app-foreground)]">
                {isReplacingOriginalCv ? 'Original CV active' : 'Import your original CV'}
              </h1>
              <p className="m-0 max-w-2xl text-lg leading-8 text-[var(--color-app-muted)]">
                {isReplacingOriginalCv
                  ? 'One original CV stays active in the workspace. Replacing it creates a new encrypted snapshot.'
                  : 'Import a PDF or DOCX original CV to unlock the rest of the workspace.'}
              </p>
              <p className="m-0 max-w-2xl text-sm leading-7 text-[var(--color-panel-warning)]">
                The app stores the source file, extracted text, normalized CV JSON, and
                writing-style profile through encrypted local storage.
              </p>
            </div>

            {activeOriginalCv ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-[8px] border border-[var(--color-panel-border)] bg-black/10 p-5">
                  <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
                    Active original CV
                  </p>
                  <p className="mt-3 text-xl text-[var(--color-app-foreground)]">
                    {activeOriginalCv.originalFilename}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-app-muted)]">
                    {activeOriginalCv.headline}
                  </p>
                </div>

                <div className="rounded-[8px] border border-[var(--color-panel-border)] bg-black/10 p-5">
                  <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
                    Snapshot history
                  </p>
                  <p className="mt-3 text-xl text-[var(--color-app-foreground)]">
                    {originalCvWorkspaceState.snapshotCount} snapshots stored
                  </p>
                  <p className="mt-2 text-sm leading-7 text-[var(--color-app-muted)]">
                    Existing tailored applications keep the snapshot reference they were generated
                    from.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <aside className="flex flex-col justify-between rounded-[8px] border border-[var(--color-panel-border)] bg-black/10 p-6">
            <div className="space-y-6">
              <p className="m-0 text-sm uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
                {isReplacingOriginalCv ? 'Replace original CV' : 'First launch'}
              </p>
              <div className="space-y-3">
                <label className="block text-sm leading-7 text-[var(--color-app-foreground)]">
                  <span className="mb-2 block">Original CV file</span>
                  <input
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    aria-label="Original CV file"
                    className="block w-full rounded-[8px] border border-[var(--color-panel-border)] bg-transparent px-4 py-3 text-sm text-[var(--color-app-foreground)] file:mr-4 file:rounded-[8px] file:border-0 file:bg-[var(--color-panel-accent)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-950"
                    onChange={handleOriginalCvSelection}
                    type="file"
                  />
                </label>
                {importError ? (
                  <p className="m-0 text-sm leading-7 text-[var(--color-panel-warning)]">
                    {importError}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-8 space-y-4">
              <button
                className="w-full rounded-[8px] border border-[var(--color-panel-accent)] bg-[var(--color-panel-accent)] px-4 py-3 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:border-[var(--color-panel-border)] disabled:bg-transparent disabled:text-[var(--color-app-muted)]"
                disabled={originalCvFile === null || isImportingOriginalCv}
                onClick={handleOriginalCvImportClick}
                type="button"
              >
                {importActionLabel}
              </button>
              <p className="m-0 text-sm leading-7 text-[var(--color-panel-warning)]">
                PDF and DOCX are supported. Scanned, image-only, empty, or weakly extracted files
                are rejected.
              </p>
            </div>
          </aside>
        </section>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <section className="grid w-full max-w-6xl gap-8 rounded-[8px] border border-[var(--color-panel-border)] bg-[var(--color-panel-background)]/90 p-8 shadow-[0_24px_80px_rgb(0_0_0_/_0.28)] backdrop-blur xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.9fr)]">
        <div className="space-y-8">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-[var(--color-panel-accent)]" />
            <p className="m-0 text-sm uppercase tracking-[0.16em] text-[var(--color-app-muted)]">
              CV Maxxing
            </p>
          </div>

          <div className="space-y-5">
            <StatusBadge status={viewModel.status} />
            <h1 className="m-0 max-w-2xl text-5xl leading-tight text-[var(--color-app-foreground)]">
              {viewModel.heading}
            </h1>
            <p className="m-0 max-w-2xl text-lg leading-8 text-[var(--color-app-muted)]">
              {viewModel.body}
            </p>
            {viewModel.diagnostic ? (
              <p className="m-0 max-w-2xl text-sm leading-7 text-[var(--color-panel-warning)]">
                {viewModel.diagnostic}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[8px] border border-[var(--color-panel-border)] bg-black/10 p-5">
              <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
                Workspace access
              </p>
              <p className="mt-3 text-xl text-[var(--color-app-foreground)]">
                {viewModel.canEnterWorkspace ? 'Unlocked' : 'Blocked'}
              </p>
            </div>

            <div className="rounded-[8px] border border-[var(--color-panel-border)] bg-black/10 p-5">
              <p className="m-0 text-xs uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
                Startup route
              </p>
              <p className="mt-3 text-xl text-[var(--color-app-foreground)]">
                {getStartupRouteLabel(viewModel)}
              </p>
            </div>
          </div>
        </div>

        <aside className="flex flex-col justify-between rounded-[8px] border border-[var(--color-panel-border)] bg-black/10 p-6">
          <div className="space-y-6">
            <p className="m-0 text-sm uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
              {viewModel.startupDestination === 'workspace_loading'
                ? 'Resume flow'
                : 'First launch'}
            </p>
            <div className="space-y-3">
              <p className="m-0 text-base leading-7 text-[var(--color-app-foreground)]">
                The desktop shell stops here until the local AI worker is healthy.
              </p>
              <p className="m-0 text-sm leading-7 text-[var(--color-app-muted)]">
                Original CV import, job vacancy drafts, and tailored application generation stay
                locked behind this route.
              </p>
              {readinessError ? (
                <p className="m-0 text-sm leading-7 text-[var(--color-panel-warning)]">
                  {readinessError}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-8 space-y-4">
            <button
              className="w-full rounded-[8px] border border-[var(--color-panel-accent)] bg-[var(--color-panel-accent)] px-4 py-3 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:border-[var(--color-panel-border)] disabled:bg-transparent disabled:text-[var(--color-app-muted)]"
              disabled={viewModel.primaryActionLabel === undefined || isSubmittingPrimaryAction}
              onClick={handlePrimaryActionClick}
              type="button"
            >
              {viewModel.primaryActionLabel ??
                (isSubmittingPrimaryAction ? 'Working...' : 'Waiting for startup check')}
            </button>
            {viewModel.secondaryActionLabel ? (
              <button
                className="w-full rounded-[8px] border border-[var(--color-panel-border)] bg-transparent px-4 py-3 text-sm font-medium text-[var(--color-app-foreground)] disabled:cursor-not-allowed disabled:text-[var(--color-app-muted)]"
                disabled={isSecondaryActionPending}
                onClick={handleSecondaryActionClick}
                type="button"
              >
                {isSecondaryActionPending
                  ? 'Opening setup guide...'
                  : viewModel.secondaryActionLabel}
              </button>
            ) : null}
            <p className="m-0 text-sm leading-7 text-[var(--color-panel-warning)]">
              No telemetry, analytics, remote config, update checks, or font CDN calls are enabled
              in this shell.
            </p>
          </div>
        </aside>
      </section>
    </main>
  )
}
