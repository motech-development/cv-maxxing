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
  VacancyBrowserPageInteractionResult,
  VacancyBrowserPageReadingInteraction,
  VacancyBrowserPageReview,
  VacancyBrowserPageSnapshot,
} from './vacancy-browser-session-service.js'
import { VacancyNormalizationError } from './vacancy-normalization-error.js'
import { inferTitleFromPageTitle, sanitizeSnapshotHtml } from './vacancy-page-content.js'
import type {
  NormalizedVacancy,
  VacancyPageInteractionHistoryEntry,
  VacancyPageReviewResult,
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
const URL_INTAKE_TIME_BUDGET_MS = 90_000
const MAX_AI_READING_INTERACTIONS = 8

interface VacancyServiceDependencies {
  captureVacancyBrowserSessionPage?: (input: {
    reviewPage?: VacancyBrowserPageReview
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
    timeBudgetMs?: number
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
      const source = normalizedUrl ? normalizeSubmittedHostname(normalizedUrl) : 'pasted_text'
      const vacancyId = generateId()
      const fetchedAt = getCurrentTimestamp()
      const normalizedVacancy = normalizeVacancyText(trimmedText)
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
        content: Buffer.from(trimmedText, 'utf8'),
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
      const source = normalizeSubmittedHostname(normalizedUrl)
      let capturedNormalizedVacancy: NormalizedVacancy | null = null

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
        reviewPage: async ({ applyReadingInteraction, getRemainingTimeMs, initialSnapshot }) => {
          const pageReviewResult = await reviewVacancyPageWithReadingInteractions({
            applyReadingInteraction,
            getRemainingTimeMs,
            initialSnapshot,
            normalizationService,
            originalUrl: normalizedUrl,
            source,
          })

          if (pageReviewResult === null) {
            return null
          }

          capturedNormalizedVacancy = pageReviewResult.normalizedVacancy

          return pageReviewResult.snapshot
        },
        shouldCapturePage: (snapshot) => {
          return isExpectedBrowserSessionVacancyPage({
            originalUrl: normalizedUrl,
            resolvedUrl: snapshot.resolvedUrl,
          })
        },
        timeBudgetMs: URL_INTAKE_TIME_BUDGET_MS,
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
          normalizedVacancy: capturedNormalizedVacancy,
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
      const source = normalizeSubmittedHostname(normalizedUrl)
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

async function reviewVacancyPageWithReadingInteractions({
  applyReadingInteraction,
  getRemainingTimeMs,
  initialSnapshot,
  normalizationService,
  originalUrl,
  source,
}: {
  applyReadingInteraction: (
    interaction: VacancyBrowserPageReadingInteraction,
  ) => Promise<VacancyBrowserPageInteractionResult>
  getRemainingTimeMs: () => number
  initialSnapshot: VacancyBrowserPageSnapshot
  normalizationService: VacancyNormalizationService
  originalUrl: string
  source: string
}): Promise<{
  normalizedVacancy: NormalizedVacancy
  snapshot: VacancyBrowserPageSnapshot
} | null> {
  let currentSnapshot = initialSnapshot
  const interactionHistory: VacancyPageInteractionHistoryEntry[] = []

  for (let attemptIndex = 0; attemptIndex <= MAX_AI_READING_INTERACTIONS; attemptIndex += 1) {
    const remainingTimeMs = getRemainingTimeMs()

    if (remainingTimeMs <= 0) {
      throw new VacancyNormalizationError({
        code: 'timeout',
        message: 'Vacancy normalization timed out.',
      })
    }

    const reviewResult = await runVacancyPageReview({
      input: {
        html: currentSnapshot.html,
        interactionHistory,
        originalUrl,
        pageTitle: currentSnapshot.pageTitle,
        resolvedUrl: currentSnapshot.resolvedUrl,
        source,
      },
      normalizationService,
      timeoutMs: remainingTimeMs,
    })

    if (reviewResult.kind === 'no_job_content') {
      return null
    }

    if (reviewResult.kind === 'success') {
      return {
        normalizedVacancy: reviewResult.normalizedVacancy,
        snapshot: currentSnapshot,
      }
    }

    const interactionResult = await applyReadingInteraction(reviewResult.interaction)

    if (interactionResult.kind === 'rejected') {
      interactionHistory.push({
        interaction: reviewResult.interaction,
        result: 'rejected',
      })

      return null
    }

    interactionHistory.push({
      interaction: reviewResult.interaction,
      result: 'captured',
    })
    currentSnapshot = interactionResult.snapshot
  }

  return null
}

async function runVacancyPageReview({
  input,
  normalizationService,
  timeoutMs,
}: {
  input: Parameters<VacancyNormalizationService['normalizeVacancy']>[0]
  normalizationService: VacancyNormalizationService
  timeoutMs: number
}): Promise<VacancyPageReviewResult> {
  if (normalizationService.reviewVacancyPage !== undefined) {
    return await normalizationService.reviewVacancyPage(input, {
      timeoutMs,
    })
  }

  try {
    const normalizedVacancy = await normalizationService.normalizeVacancy(input, {
      timeoutMs,
    })

    return {
      kind: 'success',
      normalizedVacancy,
    }
  } catch (error) {
    if (error instanceof VacancyNormalizationError && error.code === 'no_job_content') {
      return {
        kind: 'no_job_content',
      }
    }

    throw error
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

async function persistFetchedVacancyPage({
  fetchedPage,
  generateId,
  getCurrentTimestamp,
  localAppData,
  normalizationService,
  normalizedVacancy: normalizedVacancyInput = null,
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
  normalizedVacancy?: NormalizedVacancy | null
  originalUrl: string
  source: string
  workspaceSelectionStore?: Pick<WorkspaceSelectionStore, 'getSelection' | 'setSelection'>
}): Promise<VacancyIngestResult> {
  const normalizedVacancy =
    normalizedVacancyInput ??
    (await normalizationService.normalizeVacancy({
      html: fetchedPage.html,
      originalUrl,
      pageTitle: fetchedPage.pageTitle,
      resolvedUrl: fetchedPage.resolvedUrl,
      source,
    }))
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
  source: string
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

function normalizeSubmittedHostname(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase()

  if (hostname.startsWith('www.')) {
    return hostname.slice('www.'.length)
  }

  return hostname
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
      currentUrl.origin === requestedUrl.origin &&
      currentUrl.pathname === requestedUrl.pathname &&
      currentUrl.search === requestedUrl.search
    )
  } catch {
    return false
  }
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

function normalizeVacancyText(text: string): NormalizedVacancy {
  const normalizedText = text.replaceAll('\r\n', '\n').trim()
  const lines = normalizedText
    .split('\n')
    .map((line) => {
      return line.trim()
    })
    .filter((line) => {
      return line !== ''
    })
  const bodyLines: string[] = []
  const requirements: string[] = []
  const responsibilities: string[] = []
  let activeSection: 'requirements' | 'responsibilities' | null = null

  for (const line of lines.slice(3)) {
    const normalizedLine = line.toLowerCase()

    if (normalizedLine === 'requirements' || normalizedLine === 'qualifications') {
      activeSection = 'requirements'

      continue
    }

    if (
      normalizedLine === 'responsibilities' ||
      normalizedLine === 'what you will do' ||
      normalizedLine === 'about the role'
    ) {
      activeSection = 'responsibilities'

      continue
    }

    const cleanedLine = line.replace(/^[*-]\s*/, '')

    if (activeSection === 'requirements') {
      requirements.push(cleanedLine)
      bodyLines.push(cleanedLine)

      continue
    }

    if (activeSection === 'responsibilities') {
      responsibilities.push(cleanedLine)
      bodyLines.push(cleanedLine)

      continue
    }

    bodyLines.push(cleanedLine)
  }

  const location = inferLocation(lines[2])

  return {
    bodyText: bodyLines.join(' ').trim(),
    employer: normalizeNullableLine(lines[1]),
    location,
    requirements,
    responsibilities,
    title: normalizeNullableLine(lines[0]),
  }
}

function inferLocation(line: string | undefined): string | null {
  if (line === undefined) {
    return null
  }

  const normalizedLine = line.trim()

  if (normalizedLine === '') {
    return null
  }

  if (
    normalizedLine.includes(',') ||
    normalizedLine.toLowerCase().includes('remote') ||
    normalizedLine.toLowerCase().includes('hybrid')
  ) {
    return normalizedLine
  }

  return null
}

function normalizeNullableLine(line: string | undefined): string | null {
  if (line === undefined) {
    return null
  }

  const normalizedLine = line.trim()

  if (normalizedLine === '') {
    return null
  }

  return normalizedLine
}

function isVacancyReady(vacancy: NormalizedVacancy): boolean {
  const substantiveSectionsCount = vacancy.requirements.length + vacancy.responsibilities.length

  if (substantiveSectionsCount >= 2 && vacancy.bodyText.length >= 80) {
    return true
  }

  return vacancy.bodyText.length >= 180
}
