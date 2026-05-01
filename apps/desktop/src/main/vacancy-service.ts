import { randomUUID } from 'node:crypto'

import type {
  VacancyIngestResult,
  VacancyInputType,
  VacancyReviewState,
  VacancySummary,
  VacancyWorkspaceState,
} from '../shared/vacancy.js'
import {
  VACANCY_LANGUAGE_BLOCK_MESSAGE,
  assessEnglishLanguageSupport,
} from '../shared/language-support.js'
import {
  createDefaultWorkspaceSelection,
  type JobsWorkspaceSelection,
} from '../shared/workspace-selection.js'
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js'
import type {
  VacancyBrowserInteractionRequester,
  VacancyBrowserPageSnapshot,
} from './vacancy-browser-session-service.js'
import { inferTitleFromPageTitle, sanitizeSnapshotHtml } from './vacancy-page-content.js'
import { VacancyNormalizationError } from './vacancy-normalization-error.js'
import type {
  NormalizedVacancy,
  VacancyNormalizationService,
} from './vacancy-normalization-service.js'
import { VacancyUrlIntakeInteractionRequestError } from './vacancy-url-intake-interactions.js'
import type { WorkspaceSelectionStore } from './workspace-selection-store.js'

const VACANCY_DRAFT_SCOPE = 'vacancy-workspace'
const VACANCY_SCOPE = 'vacancies'
const VACANCY_WORKSPACE_RECORD_ID = 'current'
const PASTED_VACANCY_PAGE_REFERENCE = 'pasted-job-description'
const PASTED_VACANCY_PAGE_TITLE = 'Pasted job description'
const OPEN_JOB_PAGE_BLOCKING_REASON =
  'This job page may need more access. Open the job page or paste the job description instead.'
const RELOAD_JOB_PAGE_BLOCKING_REASON =
  'Open the job page and close it after the full details load, or paste the job description instead.'
const PASTED_VACANCY_NORMALIZATION_BLOCKING_REASON =
  'Paste the full job description before tailoring your CV.'
const URL_MATCHING_CLEANUP_SEARCH_PARAMETER_NAMES = new Set([
  'fbclid',
  'gclid',
  'gh_src',
  'igshid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  'msclkid',
  'trk',
])
const DEFAULT_URL_INTAKE_BUDGET_MS = 90_000

interface VacancyServiceDependencies {
  captureVacancyBrowserSessionPage?: (input: {
    requestInteraction?: VacancyBrowserInteractionRequester
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
    signal?: AbortSignal
    url: string
  }) => Promise<VacancyBrowserPageSnapshot | null>
  generateId?: () => string
  getCurrentTimestamp?: () => string
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>
  normalizationService: VacancyNormalizationService
  openVacancyBrowserSession: (input: {
    requestInteraction?: VacancyBrowserInteractionRequester
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
    signal?: AbortSignal
    url: string
  }) => Promise<VacancyBrowserPageSnapshot | null>
  urlIntakeBudgetMs?: number
  workspaceSelectionStore?: Pick<WorkspaceSelectionStore, 'getSelection' | 'setSelection'>
}

interface VacancyMetadataValue extends Record<string, JsonValue> {
  blockingReason: string | null
  canGenerate: boolean
  employer: string | null
  fetchedAt: string
  inputType: VacancyInputType
  location: string | null
  originalUrl: string | null
  requirements: string[]
  resolvedUrl: string | null
  responsibilities: string[]
  source: string
  status: 'incomplete' | 'ready'
  textPreview: string
  title: string | null
}

interface VacancyDraftMetadataValue extends Record<string, JsonValue> {
  reviewState: VacancyReviewState | null
  text: string
  url: string
  vacancyId: string | null
}

export interface VacancyService {
  resetWorkspaceState: () => Promise<void>
  getWorkspaceState: () => Promise<VacancyWorkspaceState>
  ingestPastedVacancy: (input: { text: string; url?: string }) => Promise<VacancyIngestResult>
  ingestVacancyUrl: (input: { url: string }) => Promise<VacancyIngestResult>
  openBrowserSession: (input: { url: string }) => Promise<VacancyIngestResult>
}

export function createVacancyService({
  captureVacancyBrowserSessionPage = () => Promise.resolve(null),
  generateId = randomUUID,
  getCurrentTimestamp = () => {
    return new Date().toISOString()
  },
  localAppData,
  normalizationService,
  openVacancyBrowserSession,
  urlIntakeBudgetMs = DEFAULT_URL_INTAKE_BUDGET_MS,
  workspaceSelectionStore,
}: VacancyServiceDependencies): VacancyService {
  const resolvedUrlIntakeBudgetMs = resolveUrlIntakeBudgetMs(urlIntakeBudgetMs)

  return {
    resetWorkspaceState: async (): Promise<void> => {
      await localAppData.metadata.delete({
        id: VACANCY_WORKSPACE_RECORD_ID,
        scope: VACANCY_DRAFT_SCOPE,
      })

      await persistJobsWorkspaceSelection({
        jobs: {
          kind: 'none',
        },
        workspaceSelectionStore,
      })
    },
    getWorkspaceState: async (): Promise<VacancyWorkspaceState> => {
      const draftRecord = await localAppData.metadata.get<VacancyDraftMetadataValue>({
        id: VACANCY_WORKSPACE_RECORD_ID,
        scope: VACANCY_DRAFT_SCOPE,
      })

      if (draftRecord?.vacancyId === null || draftRecord?.vacancyId === undefined) {
        return {
          draft: {
            text: draftRecord?.text ?? '',
            url: draftRecord?.url ?? '',
          },
          reviewState: 'editable',
          vacancy: null,
        }
      }

      return await buildVacancyWorkspaceState({
        draftRecord,
        localAppData,
      })
    },
    ingestPastedVacancy: async ({
      text,
      url,
    }: {
      text: string
      url?: string
    }): Promise<VacancyIngestResult> => {
      const trimmedText = text.trim()
      const normalizedUrl = normalizeUrl(url)
      const source =
        normalizedUrl === null
          ? PASTED_VACANCY_PAGE_REFERENCE
          : normalizeSubmittedUrlHostname(normalizedUrl)
      const fetchedAt = getCurrentTimestamp()
      let normalizedVacancy: NormalizedVacancy

      try {
        normalizedVacancy = await normalizationService.normalizeVacancy({
          html: buildPastedVacancyHtml(trimmedText),
          originalUrl: normalizedUrl ?? PASTED_VACANCY_PAGE_REFERENCE,
          pageTitle: PASTED_VACANCY_PAGE_TITLE,
          resolvedUrl: normalizedUrl ?? PASTED_VACANCY_PAGE_REFERENCE,
          source,
        })
      } catch (error) {
        if (error instanceof VacancyNormalizationError) {
          return await createPastedVacancyNormalizationFailureResult({
            fetchedAt,
            localAppData,
            normalizedUrl,
            source,
            text: trimmedText,
            workspaceSelectionStore,
          })
        }

        throw error
      }

      const vacancyId = generateId()
      const extractedText = normalizedVacancy.bodyText.trim()
      const isLanguageBlocked =
        assessEnglishLanguageSupport(trimmedText).status === 'blocked' ||
        assessEnglishLanguageSupport(extractedText).status === 'blocked'
      const canGenerate = !isLanguageBlocked && isVacancyReady(normalizedVacancy)
      let blockingReason: string | null = null

      if (isLanguageBlocked) {
        blockingReason = VACANCY_LANGUAGE_BLOCK_MESSAGE
      } else if (!canGenerate) {
        blockingReason =
          'Add the full job responsibilities or requirements before tailoring your CV.'
      }

      const vacancy = toVacancySummary({
        id: vacancyId,
        metadata: {
          blockingReason,
          canGenerate,
          employer: normalizedVacancy.employer,
          fetchedAt,
          inputType: 'pasted_text',
          location: normalizedVacancy.location,
          originalUrl: normalizedUrl,
          requirements: normalizedVacancy.requirements,
          resolvedUrl: normalizedUrl,
          responsibilities: normalizedVacancy.responsibilities,
          source,
          status: canGenerate ? 'ready' : 'incomplete',
          textPreview: normalizedVacancy.bodyText.slice(0, 280),
          title: normalizedVacancy.title,
        },
      })

      await localAppData.metadata.put({
        id: vacancyId,
        scope: VACANCY_SCOPE,
        value: toVacancyMetadataValue(vacancy),
      })
      await localAppData.artifacts.write({
        content: Buffer.from(extractedText, 'utf8'),
        id: vacancyId,
        name: 'extracted.txt',
        scope: VACANCY_SCOPE,
      })
      await localAppData.artifacts.write({
        content: Buffer.from(JSON.stringify(normalizedVacancy), 'utf8'),
        id: vacancyId,
        name: 'normalized.json',
        scope: VACANCY_SCOPE,
      })
      await localAppData.metadata.put({
        id: VACANCY_WORKSPACE_RECORD_ID,
        scope: VACANCY_DRAFT_SCOPE,
        value: {
          reviewState: canGenerate ? 'reviewed' : 'editable',
          text: trimmedText,
          url: normalizedUrl ?? '',
          vacancyId,
        } satisfies VacancyDraftMetadataValue,
      })
      await persistJobsWorkspaceSelection({
        jobs: {
          kind: 'draft',
        },
        workspaceSelectionStore,
      })

      const workspaceState = await thisGetWorkspaceState(localAppData)

      return {
        kind: canGenerate ? 'ingested' : 'incomplete',
        vacancy,
        workspaceState,
      }
    },
    ingestVacancyUrl: async ({ url }: { url: string }): Promise<VacancyIngestResult> => {
      const normalizedUrl = requireUrl(url)
      const source = normalizeSubmittedUrlHostname(normalizedUrl)
      const intakeBudget = createUrlIntakeBudget(resolvedUrlIntakeBudgetMs)

      try {
        await persistVacancyWorkspaceDraft({
          localAppData,
          url: normalizedUrl,
        })
        await persistJobsWorkspaceSelection({
          jobs: {
            kind: 'draft',
          },
          workspaceSelectionStore,
        })

        const capturedBrowserSnapshot = await captureVacancyBrowserSessionPage({
          requestInteraction: createVacancyUrlInteractionRequester({
            normalizationService,
            originalUrl: normalizedUrl,
            signal: intakeBudget.signal,
            source,
          }),
          shouldCapturePage: (snapshot) => {
            return isExpectedBrowserSessionVacancyPage({
              originalUrl: normalizedUrl,
              resolvedUrl: snapshot.resolvedUrl,
            })
          },
          signal: intakeBudget.signal,
          url: normalizedUrl,
        })

        if (
          capturedBrowserSnapshot === null ||
          !isExpectedBrowserSessionVacancyPage({
            originalUrl: normalizedUrl,
            resolvedUrl: capturedBrowserSnapshot.resolvedUrl,
          })
        ) {
          return await createInteractiveBrowserFallbackResult({
            getCurrentTimestamp,
            localAppData,
            originalUrl: normalizedUrl,
            source,
          })
        }

        return await persistFetchedVacancyPage({
          fetchedPage: capturedBrowserSnapshot,
          generateId,
          getCurrentTimestamp,
          localAppData,
          normalizationService,
          originalUrl: normalizedUrl,
          signal: intakeBudget.signal,
          source,
          workspaceSelectionStore,
        })
      } finally {
        intakeBudget.clear()
      }
    },
    openBrowserSession: async ({ url }: { url: string }): Promise<VacancyIngestResult> => {
      const normalizedUrl = requireUrl(url)
      const source = normalizeSubmittedUrlHostname(normalizedUrl)
      const intakeBudget = createUrlIntakeBudget(resolvedUrlIntakeBudgetMs)

      try {
        const browserSnapshot = await openVacancyBrowserSession({
          requestInteraction: createVacancyUrlInteractionRequester({
            normalizationService,
            originalUrl: normalizedUrl,
            signal: intakeBudget.signal,
            source,
          }),
          shouldCapturePage: (snapshot) => {
            return isExpectedBrowserSessionVacancyPage({
              originalUrl: normalizedUrl,
              resolvedUrl: snapshot.resolvedUrl,
            })
          },
          signal: intakeBudget.signal,
          url: normalizedUrl,
        })

        if (
          browserSnapshot === null ||
          !isExpectedBrowserSessionVacancyPage({
            originalUrl: normalizedUrl,
            resolvedUrl: browserSnapshot.resolvedUrl,
          })
        ) {
          const incompleteVacancy = createBlockedVacancySummary({
            blockingReason: RELOAD_JOB_PAGE_BLOCKING_REASON,
            fetchedAt: getCurrentTimestamp(),
            inputType: 'url',
            originalUrl: normalizedUrl,
            source,
          })

          await persistVacancyWorkspaceDraft({
            localAppData,
            url: normalizedUrl,
          })
          await persistJobsWorkspaceSelection({
            jobs: {
              kind: 'draft',
            },
            workspaceSelectionStore,
          })

          return {
            kind: 'incomplete',
            vacancy: incompleteVacancy,
            workspaceState: await thisGetWorkspaceState(localAppData),
          }
        }

        return await persistFetchedVacancyPage({
          fetchedPage: browserSnapshot,
          generateId,
          getCurrentTimestamp,
          localAppData,
          normalizationService,
          originalUrl: normalizedUrl,
          signal: intakeBudget.signal,
          source,
          workspaceSelectionStore,
        })
      } finally {
        intakeBudget.clear()
      }
    },
  }
}

async function createPastedVacancyNormalizationFailureResult({
  fetchedAt,
  localAppData,
  normalizedUrl,
  source,
  text,
  workspaceSelectionStore,
}: {
  fetchedAt: string
  localAppData: Pick<LocalAppDataStore, 'metadata'>
  normalizedUrl: string | null
  source: string
  text: string
  workspaceSelectionStore?: Pick<WorkspaceSelectionStore, 'getSelection' | 'setSelection'>
}): Promise<VacancyIngestResult> {
  const incompleteVacancy = createBlockedVacancySummary({
    blockingReason: PASTED_VACANCY_NORMALIZATION_BLOCKING_REASON,
    fetchedAt,
    id: 'vacancy-pending-pasted-text',
    inputType: 'pasted_text',
    originalUrl: normalizedUrl,
    source,
  })

  await localAppData.metadata.put({
    id: VACANCY_WORKSPACE_RECORD_ID,
    scope: VACANCY_DRAFT_SCOPE,
    value: {
      reviewState: 'editable',
      text,
      url: normalizedUrl ?? '',
      vacancyId: null,
    } satisfies VacancyDraftMetadataValue,
  })
  await persistJobsWorkspaceSelection({
    jobs: {
      kind: 'draft',
    },
    workspaceSelectionStore,
  })

  return {
    kind: 'incomplete',
    vacancy: incompleteVacancy,
    workspaceState: await thisGetWorkspaceState(localAppData),
  }
}

async function createInteractiveBrowserFallbackResult({
  getCurrentTimestamp,
  localAppData,
  originalUrl,
  source,
}: {
  getCurrentTimestamp: () => string
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>
  originalUrl: string
  source: string
}): Promise<VacancyIngestResult> {
  const incompleteVacancy = createBlockedVacancySummary({
    blockingReason: OPEN_JOB_PAGE_BLOCKING_REASON,
    fetchedAt: getCurrentTimestamp(),
    inputType: 'url',
    originalUrl,
    source,
  })

  return {
    kind: 'incomplete',
    vacancy: incompleteVacancy,
    workspaceState: await thisGetWorkspaceState(localAppData),
  }
}

function createVacancyUrlInteractionRequester({
  normalizationService,
  originalUrl,
  signal,
  source,
}: {
  normalizationService: VacancyNormalizationService
  originalUrl: string
  signal: AbortSignal
  source: string
}): VacancyBrowserInteractionRequester {
  return async (snapshot) => {
    try {
      await normalizationService.normalizeVacancy(
        {
          html: snapshot.html,
          originalUrl,
          pageTitle: snapshot.pageTitle,
          resolvedUrl: snapshot.resolvedUrl,
          source,
        },
        {
          signal,
        },
      )

      return null
    } catch (error) {
      if (error instanceof VacancyUrlIntakeInteractionRequestError) {
        return error.interaction
      }

      if (error instanceof VacancyNormalizationError) {
        return null
      }

      throw error
    }
  }
}

async function persistFetchedVacancyPage({
  fetchedPage,
  generateId,
  getCurrentTimestamp,
  localAppData,
  normalizationService,
  originalUrl,
  signal,
  source,
  workspaceSelectionStore,
}: {
  fetchedPage: {
    html: string
    pageTitle: string | null
    resolvedUrl: string
  }
  generateId: () => string
  getCurrentTimestamp: () => string
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>
  normalizationService: VacancyNormalizationService
  originalUrl: string
  signal?: AbortSignal
  source: string
  workspaceSelectionStore?: Pick<WorkspaceSelectionStore, 'getSelection' | 'setSelection'>
}): Promise<VacancyIngestResult> {
  const normalizedVacancy = await normalizationService.normalizeVacancy(
    {
      html: fetchedPage.html,
      originalUrl,
      pageTitle: fetchedPage.pageTitle,
      resolvedUrl: fetchedPage.resolvedUrl,
      source,
    },
    {
      signal,
    },
  )
  const vacancyId = generateId()
  const fetchedAt = getCurrentTimestamp()
  const extractedText = normalizedVacancy.bodyText.trim()
  const isLanguageBlocked = assessEnglishLanguageSupport(extractedText).status === 'blocked'
  const canGenerate = !isLanguageBlocked && isVacancyReady(normalizedVacancy)
  let blockingReason: string | null = null

  if (isLanguageBlocked) {
    blockingReason = VACANCY_LANGUAGE_BLOCK_MESSAGE
  } else if (!canGenerate) {
    blockingReason = 'Add the full job responsibilities or requirements before tailoring your CV.'
  }

  const vacancy = toVacancySummary({
    id: vacancyId,
    metadata: {
      blockingReason,
      canGenerate,
      employer: normalizedVacancy.employer,
      fetchedAt,
      inputType: 'url',
      location: normalizedVacancy.location,
      originalUrl,
      requirements: normalizedVacancy.requirements,
      resolvedUrl: fetchedPage.resolvedUrl,
      responsibilities: normalizedVacancy.responsibilities,
      source,
      status: canGenerate ? 'ready' : 'incomplete',
      textPreview: normalizedVacancy.bodyText.slice(0, 280),
      title: normalizedVacancy.title ?? inferTitleFromPageTitle(fetchedPage.pageTitle),
    },
  })

  await localAppData.metadata.put({
    id: vacancyId,
    scope: VACANCY_SCOPE,
    value: toVacancyMetadataValue(vacancy),
  })
  await localAppData.artifacts.write({
    content: Buffer.from(sanitizeSnapshotHtml(fetchedPage.html), 'utf8'),
    id: vacancyId,
    name: 'snapshot.html',
    scope: VACANCY_SCOPE,
  })
  await localAppData.artifacts.write({
    content: Buffer.from(extractedText, 'utf8'),
    id: vacancyId,
    name: 'extracted.txt',
    scope: VACANCY_SCOPE,
  })
  await localAppData.artifacts.write({
    content: Buffer.from(JSON.stringify(normalizedVacancy), 'utf8'),
    id: vacancyId,
    name: 'normalized.json',
    scope: VACANCY_SCOPE,
  })
  await localAppData.metadata.put({
    id: VACANCY_WORKSPACE_RECORD_ID,
    scope: VACANCY_DRAFT_SCOPE,
    value: {
      reviewState: canGenerate ? 'reviewed' : 'editable',
      text: '',
      url: originalUrl,
      vacancyId,
    } satisfies VacancyDraftMetadataValue,
  })
  await persistJobsWorkspaceSelection({
    jobs: {
      kind: 'draft',
    },
    workspaceSelectionStore,
  })

  return {
    kind: canGenerate ? 'ingested' : 'incomplete',
    vacancy,
    workspaceState: await thisGetWorkspaceState(localAppData),
  }
}

async function persistJobsWorkspaceSelection({
  jobs,
  workspaceSelectionStore,
}: {
  jobs: JobsWorkspaceSelection
  workspaceSelectionStore?: Pick<WorkspaceSelectionStore, 'getSelection' | 'setSelection'>
}): Promise<void> {
  if (workspaceSelectionStore === undefined) {
    return
  }

  const currentSelection =
    (await workspaceSelectionStore.getSelection()) ?? createDefaultWorkspaceSelection()

  await workspaceSelectionStore.setSelection({
    ...currentSelection,
    jobs,
    topLevelSection: 'job_vacancies',
  })
}

function createBlockedVacancySummary({
  blockingReason,
  fetchedAt,
  id = 'vacancy-pending-browser',
  inputType,
  originalUrl,
  source,
}: {
  blockingReason: string
  fetchedAt: string
  id?: string
  inputType: VacancyInputType
  originalUrl: string | null
  source: string
}): VacancySummary {
  return {
    blockingReason,
    canGenerate: false,
    employer: null,
    fetchedAt,
    id,
    inputType,
    location: null,
    originalUrl,
    requirements: [],
    resolvedUrl: null,
    responsibilities: [],
    source,
    status: 'incomplete',
    textPreview: '',
    title: null,
  }
}

async function thisGetWorkspaceState(
  localAppData: Pick<LocalAppDataStore, 'metadata'>,
): Promise<VacancyWorkspaceState> {
  const draftRecord = await localAppData.metadata.get<VacancyDraftMetadataValue>({
    id: VACANCY_WORKSPACE_RECORD_ID,
    scope: VACANCY_DRAFT_SCOPE,
  })

  if (draftRecord?.vacancyId === null || draftRecord?.vacancyId === undefined) {
    return {
      draft: {
        text: draftRecord?.text ?? '',
        url: draftRecord?.url ?? '',
      },
      reviewState: 'editable',
      vacancy: null,
    }
  }

  return await buildVacancyWorkspaceState({
    draftRecord,
    localAppData,
  })
}

async function persistVacancyWorkspaceDraft({
  localAppData,
  url,
}: {
  localAppData: Pick<LocalAppDataStore, 'metadata'>
  url: string
}): Promise<void> {
  await localAppData.metadata.put({
    id: VACANCY_WORKSPACE_RECORD_ID,
    scope: VACANCY_DRAFT_SCOPE,
    value: {
      reviewState: 'editable',
      text: '',
      url,
      vacancyId: null,
    } satisfies VacancyDraftMetadataValue,
  })
}

async function buildVacancyWorkspaceState({
  draftRecord,
  localAppData,
}: {
  draftRecord: VacancyDraftMetadataValue
  localAppData: Pick<LocalAppDataStore, 'metadata'>
}): Promise<VacancyWorkspaceState> {
  if (draftRecord.vacancyId === null) {
    return {
      draft: {
        text: draftRecord.text,
        url: draftRecord.url,
      },
      reviewState: 'editable',
      vacancy: null,
    }
  }

  const vacancyRecord = await localAppData.metadata.get<VacancyMetadataValue>({
    id: draftRecord.vacancyId,
    scope: VACANCY_SCOPE,
  })
  const vacancy =
    vacancyRecord === null
      ? null
      : toVacancySummary({
          id: draftRecord.vacancyId,
          metadata: vacancyRecord,
        })

  return {
    draft: {
      text: draftRecord.text,
      url: draftRecord.url,
    },
    reviewState: resolveVacancyReviewState({
      draftRecord,
      vacancyRecord,
    }),
    vacancy,
  }
}

function resolveVacancyReviewState({
  draftRecord,
  vacancyRecord,
}: {
  draftRecord: VacancyDraftMetadataValue
  vacancyRecord: VacancyMetadataValue | null
}): VacancyReviewState {
  if (vacancyRecord === null) {
    return 'editable'
  }

  if (draftRecord.reviewState === 'reviewed') {
    return 'reviewed'
  }

  if (draftRecord.reviewState === 'editable') {
    return 'editable'
  }

  if (vacancyRecord.canGenerate && vacancyRecord.status === 'ready') {
    return 'reviewed'
  }

  return 'editable'
}

function toVacancyMetadataValue(vacancy: VacancySummary): VacancyMetadataValue {
  return {
    blockingReason: vacancy.blockingReason,
    canGenerate: vacancy.canGenerate,
    employer: vacancy.employer,
    fetchedAt: vacancy.fetchedAt,
    inputType: vacancy.inputType,
    location: vacancy.location,
    originalUrl: vacancy.originalUrl,
    requirements: vacancy.requirements,
    resolvedUrl: vacancy.resolvedUrl,
    responsibilities: vacancy.responsibilities,
    source: vacancy.source,
    status: vacancy.status,
    textPreview: vacancy.textPreview,
    title: vacancy.title,
  }
}

function toVacancySummary({
  id,
  metadata,
}: {
  id: string
  metadata: VacancyMetadataValue
}): VacancySummary {
  return {
    blockingReason: metadata.blockingReason,
    canGenerate: metadata.canGenerate,
    employer: metadata.employer,
    fetchedAt: metadata.fetchedAt,
    id,
    inputType: metadata.inputType,
    location: metadata.location,
    originalUrl: metadata.originalUrl,
    requirements: metadata.requirements,
    resolvedUrl: metadata.resolvedUrl,
    responsibilities: metadata.responsibilities,
    source: metadata.source,
    status: metadata.status,
    textPreview: metadata.textPreview,
    title: metadata.title,
  }
}

function isExpectedBrowserSessionVacancyPage({
  originalUrl,
  resolvedUrl,
}: {
  originalUrl: string
  resolvedUrl: string
}): boolean {
  try {
    return normalizeMatchingUrl(resolvedUrl) === normalizeMatchingUrl(originalUrl)
  } catch {
    return false
  }
}

function normalizeMatchingUrl(url: string): string {
  const parsedUrl = new URL(url)
  const origin = `${parsedUrl.protocol.toLowerCase()}//${parsedUrl.host.toLowerCase()}`
  const pathname = normalizeMatchingPathname(parsedUrl.pathname)
  const search = normalizeMatchingSearch(parsedUrl.searchParams)

  return `${origin}${pathname}${search}`
}

function normalizeMatchingPathname(pathname: string): string {
  const trimmedPathname = pathname.replace(/\/+$/u, '')

  return trimmedPathname === '' ? '/' : trimmedPathname
}

function normalizeMatchingSearch(searchParameters: URLSearchParams): string {
  const sortedEntries = [...searchParameters.entries()]
    .filter(([key]) => {
      return !isUrlMatchingCleanupSearchParameter(key)
    })
    .toSorted(([leftKey, leftValue], [rightKey, rightValue]) => {
      const normalizedLeftKey = leftKey.toLowerCase()
      const normalizedRightKey = rightKey.toLowerCase()
      const keyComparison = normalizedLeftKey.localeCompare(normalizedRightKey)

      return keyComparison === 0 ? leftValue.localeCompare(rightValue) : keyComparison
    })
  const normalizedSearch = new URLSearchParams(sortedEntries).toString()

  return normalizedSearch === '' ? '' : `?${normalizedSearch}`
}

function isUrlMatchingCleanupSearchParameter(key: string): boolean {
  const normalizedKey = key.toLowerCase()

  return (
    normalizedKey.startsWith('utm_') ||
    URL_MATCHING_CLEANUP_SEARCH_PARAMETER_NAMES.has(normalizedKey)
  )
}

function normalizeUrl(url: string | undefined): string | null {
  if (url === undefined || url.trim() === '') {
    return null
  }

  try {
    return new URL(url).toString()
  } catch {
    return null
  }
}

function requireUrl(url: string): string {
  const normalizedUrl = normalizeUrl(url)

  if (normalizedUrl === null) {
    throw new TypeError('A vacancy URL is required.')
  }

  return normalizedUrl
}

function normalizeSubmittedUrlHostname(url: string): string {
  const { hostname } = new URL(url)
  const lowercasedHostname = hostname.toLowerCase()

  return lowercasedHostname.startsWith('www.')
    ? lowercasedHostname.slice('www.'.length)
    : lowercasedHostname
}

function resolveUrlIntakeBudgetMs(urlIntakeBudgetMs: number): number {
  if (!Number.isFinite(urlIntakeBudgetMs) || urlIntakeBudgetMs <= 0) {
    return DEFAULT_URL_INTAKE_BUDGET_MS
  }

  return Math.trunc(urlIntakeBudgetMs)
}

function createUrlIntakeBudget(urlIntakeBudgetMs: number): {
  clear: () => void
  signal: AbortSignal
} {
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => {
    abortController.abort(new Error('Vacancy URL intake timed out.'))
  }, urlIntakeBudgetMs)

  return {
    clear: () => {
      clearTimeout(timeoutId)
    },
    signal: abortController.signal,
  }
}

function buildPastedVacancyHtml(text: string): string {
  return [
    '<html>',
    '<body>',
    '<main>',
    '<article>',
    `<h1>${PASTED_VACANCY_PAGE_TITLE}</h1>`,
    `<pre>${escapeHtml(text)}</pre>`,
    '</article>',
    '</main>',
    '</body>',
    '</html>',
  ].join('')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function isVacancyReady(vacancy: NormalizedVacancy): boolean {
  const substantiveSectionsCount = vacancy.requirements.length + vacancy.responsibilities.length

  if (substantiveSectionsCount >= 2 && vacancy.bodyText.length >= 80) {
    return true
  }

  return vacancy.bodyText.length >= 180
}
