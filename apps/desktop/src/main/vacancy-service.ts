import { randomUUID } from 'node:crypto'

import type {
  VacancyIngestResult,
  VacancyInputType,
  VacancyReviewState,
  VacancySource,
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
import type { VacancyBrowserPageSnapshot } from './vacancy-browser-session-service.js'
import { VacancyNormalizationError } from './vacancy-normalization-error.js'
import { inferTitleFromPageTitle, sanitizeSnapshotHtml } from './vacancy-page-content.js'
import type {
  NormalizedVacancy,
  VacancyNormalizationService,
} from './vacancy-normalization-service.js'
import type { WorkspaceSelectionStore } from './workspace-selection-store.js'

const VACANCY_DRAFT_SCOPE = 'vacancy-workspace'
const VACANCY_SCOPE = 'vacancies'
const VACANCY_WORKSPACE_RECORD_ID = 'current'
const OPEN_JOB_PAGE_BLOCKING_REASON =
  'This job page may need more access. Open the job page or paste the job description instead.'
const RELOAD_JOB_PAGE_BLOCKING_REASON =
  'Open the job page and close it after the full details load, or paste the job description instead.'

interface VacancyServiceDependencies {
  captureVacancyBrowserSessionPage?: (input: {
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
    url: string
  }) => Promise<VacancyBrowserPageSnapshot | null>
  generateId?: () => string
  getCurrentTimestamp?: () => string
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>
  normalizationService: VacancyNormalizationService
  openVacancyBrowserSession: (input: {
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
    url: string
  }) => Promise<VacancyBrowserPageSnapshot | null>
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
  source: VacancySource
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
  workspaceSelectionStore,
}: VacancyServiceDependencies): VacancyService {
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
      const source = normalizedUrl ? resolveSubmittedUrlSource(normalizedUrl) : 'generic'
      const vacancyId = generateId()
      const fetchedAt = getCurrentTimestamp()
      const normalizedVacancy = await normalizationService.normalizeVacancy({
        html: createPastedVacancyHtml(trimmedText),
        inputType: 'pasted_text',
        originalUrl: normalizedUrl,
        pageTitle: null,
        resolvedUrl: normalizedUrl,
        source,
      })
      const extractedText = normalizedVacancy.bodyText.trim()
      const isLanguageBlocked = assessEnglishLanguageSupport(trimmedText).status === 'blocked'
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
      const source = resolveSubmittedUrlSource(normalizedUrl)

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
        shouldCapturePage: (snapshot) => {
          return isExpectedBrowserSessionVacancyPage({
            originalUrl: normalizedUrl,
            resolvedUrl: snapshot.resolvedUrl,
          })
        },
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

      try {
        return await persistFetchedVacancyPage({
          fetchedPage: capturedBrowserSnapshot,
          generateId,
          getCurrentTimestamp,
          localAppData,
          normalizationService,
          originalUrl: normalizedUrl,
          source,
          workspaceSelectionStore,
        })
      } catch (error) {
        if (isSilentCaptureFallbackError(error)) {
          return await createInteractiveBrowserFallbackResult({
            getCurrentTimestamp,
            localAppData,
            originalUrl: normalizedUrl,
            source,
          })
        }

        throw error
      }
    },
    openBrowserSession: async ({ url }: { url: string }): Promise<VacancyIngestResult> => {
      const normalizedUrl = requireUrl(url)
      const source = resolveSubmittedUrlSource(normalizedUrl)
      const browserSnapshot = await openVacancyBrowserSession({
        shouldCapturePage: (snapshot) => {
          return isExpectedBrowserSessionVacancyPage({
            originalUrl: normalizedUrl,
            resolvedUrl: snapshot.resolvedUrl,
          })
        },
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
        source,
        workspaceSelectionStore,
      })
    },
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
  source: VacancySource
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

async function persistFetchedVacancyPage({
  fetchedPage,
  generateId,
  getCurrentTimestamp,
  localAppData,
  normalizationService,
  originalUrl,
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
  source: VacancySource
  workspaceSelectionStore?: Pick<WorkspaceSelectionStore, 'getSelection' | 'setSelection'>
}): Promise<VacancyIngestResult> {
  const normalizedVacancy = await normalizationService.normalizeVacancy({
    html: fetchedPage.html,
    inputType: 'url',
    originalUrl,
    pageTitle: fetchedPage.pageTitle,
    resolvedUrl: fetchedPage.resolvedUrl,
    source,
  })
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
  inputType,
  originalUrl,
  source,
}: {
  blockingReason: string
  fetchedAt: string
  inputType: VacancyInputType
  originalUrl: string
  source: VacancySource
}): VacancySummary {
  return {
    blockingReason,
    canGenerate: false,
    employer: null,
    fetchedAt,
    id: 'vacancy-pending-browser',
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
    const requestedUrl = new URL(originalUrl)
    const currentUrl = new URL(resolvedUrl)

    return (
      currentUrl.hostname.toLowerCase() === requestedUrl.hostname.toLowerCase() &&
      currentUrl.pathname === requestedUrl.pathname &&
      currentUrl.search === requestedUrl.search
    )
  } catch {
    return false
  }
}

function resolveSubmittedUrlSource(url: string): VacancySource {
  return new URL(url).hostname.toLowerCase().replace(/^www\./u, '')
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

function isSilentCaptureFallbackError(error: unknown): boolean {
  return error instanceof VacancyNormalizationError && error.code === 'no_job_content'
}

function requireUrl(url: string): string {
  const normalizedUrl = normalizeUrl(url)

  if (normalizedUrl === null) {
    throw new TypeError('A vacancy URL is required.')
  }

  return normalizedUrl
}

function createPastedVacancyHtml(text: string): string {
  return `<main><pre>${escapeHtml(text)}</pre></main>`
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
