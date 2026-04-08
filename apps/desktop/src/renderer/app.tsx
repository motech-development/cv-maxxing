import { useEffect, useState } from 'react'

import { createReadinessRouteViewModel } from '../readiness/readiness-route.js'
import type { ReadinessRouteViewModel } from '../readiness/readiness-route.js'

const initialReadinessViewModel: ReadinessRouteViewModel = {
  body: 'Checking the local AI worker before opening your workspace.',
  canEnterWorkspace: false,
  heading: 'AI worker setup',
  retryLabel: undefined,
  status: 'checking',
}

const readinessErrorMessage = 'Unable to complete the AI worker startup check.'
const readinessErrorAction = 'Restart the app or verify the local AI worker setup.'

function StatusBadge({ status }: { status: ReadinessRouteViewModel['status'] }) {
  const statusCopy = {
    checking: 'Checking',
    ready: 'Ready',
    unavailable: 'Unavailable',
  } as const

  return (
    <span className="rounded-full border border-[var(--color-panel-border)] bg-[var(--color-panel-accent-soft)] px-3 py-1 text-xs uppercase tracking-[0.12em] text-[var(--color-panel-accent)]">
      {statusCopy[status]}
    </span>
  )
}

export function App() {
  const [viewModel, setViewModel] = useState(initialReadinessViewModel)
  const [readinessError, setReadinessError] = useState<string | null>(null)

  useEffect(() => {
    const loadReadinessState = async (): Promise<void> => {
      const nextViewModel = await createReadinessRouteViewModel({
        getAiWorkerPreflight: globalThis.window.cvMaxxing.aiWorker.getAiWorkerPreflight,
      })

      setReadinessError(null)
      setViewModel(nextViewModel)
    }

    loadReadinessState().catch(() => {
      setReadinessError(`${readinessErrorMessage} ${readinessErrorAction}`)
    })
  }, [])

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
                AI worker readiness gate
              </p>
            </div>
          </div>
        </div>

        <aside className="flex flex-col justify-between rounded-[8px] border border-[var(--color-panel-border)] bg-black/10 p-6">
          <div className="space-y-6">
            <p className="m-0 text-sm uppercase tracking-[0.12em] text-[var(--color-app-muted)]">
              First launch
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
              disabled={viewModel.retryLabel === undefined}
              type="button"
            >
              {viewModel.retryLabel ?? 'Waiting for startup check'}
            </button>
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
