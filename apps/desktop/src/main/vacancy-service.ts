import { randomUUID } from 'node:crypto'

import type {
  VacancyIngestResult,
  VacancyInputType,
  VacancySource,
  VacancySummary,
  VacancyWorkspaceState,
} from '../shared/vacancy.js'
import {
  VACANCY_LANGUAGE_BLOCK_MESSAGE,
  assessEnglishLanguageSupport,
} from '../shared/language-support.js'
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js'
import type { VacancyBrowserPageSnapshot } from './vacancy-browser-session-service.js'
import { VacancyNormalizationError } from './vacancy-normalization-error.js'
import {
  inferPageTitle,
  inferTitleFromPageTitle,
  sanitizeSnapshotHtml,
} from './vacancy-page-content.js'
import type {
  NormalizedVacancy,
  VacancyNormalizationService,
} from './vacancy-normalization-service.js'

const VACANCY_DRAFT_SCOPE = 'vacancy-workspace'
const VACANCY_FETCH_TIMEOUT_MS = 15_000
const VACANCY_SCOPE = 'vacancies'
const VACANCY_WORKSPACE_RECORD_ID = 'current'

interface VacancyServiceDependencies {
  captureVacancyBrowserSessionPage?: (input: {
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
    url: string
  }) => Promise<VacancyBrowserPageSnapshot | null>
  fetchVacancyPage?: (url: string) => Promise<{
    html: string
    pageTitle: string | null
    resolvedUrl: string
  }>
  generateId?: () => string
  getCurrentTimestamp?: () => string
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>
  normalizationService: VacancyNormalizationService
  openVacancyBrowserSession: (input: {
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean
    url: string
  }) => Promise<VacancyBrowserPageSnapshot | null>
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
  fetchVacancyPage = fetchVacancyPageFromNetwork,
  generateId = randomUUID,
  getCurrentTimestamp = () => {
    return new Date().toISOString()
  },
  localAppData,
  normalizationService,
  openVacancyBrowserSession,
}: VacancyServiceDependencies): VacancyService {
  return {
    resetWorkspaceState: async (): Promise<void> => {
      await localAppData.metadata.delete({
        id: VACANCY_WORKSPACE_RECORD_ID,
        scope: VACANCY_DRAFT_SCOPE,
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
          vacancy: null,
        }
      }

      const vacancyRecord = await localAppData.metadata.get<VacancyMetadataValue>({
        id: draftRecord.vacancyId,
        scope: VACANCY_SCOPE,
      })

      return {
        draft: {
          text: draftRecord.text,
          url: draftRecord.url,
        },
        vacancy: vacancyRecord
          ? toVacancySummary({
              id: draftRecord.vacancyId,
              metadata: vacancyRecord,
            })
          : null,
      }
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
      const source = normalizedUrl ? classifyVacancyUrl(normalizedUrl) : 'generic'
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
          'Add the full job responsibilities or requirements before adapting this CV.'
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
          text: trimmedText,
          url: normalizedUrl ?? '',
          vacancyId,
        } satisfies VacancyDraftMetadataValue,
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
      const source = classifyVacancyUrl(normalizedUrl)

      if (source === 'linkedin' || source === 'indeed') {
        await persistVacancyWorkspaceDraft({
          localAppData,
          url: normalizedUrl,
        })

        const capturedBrowserSnapshot = await captureVacancyBrowserSessionPage({
          shouldCapturePage: (snapshot) => {
            return isExpectedBrowserSessionVacancyPage({
              originalUrl: normalizedUrl,
              resolvedUrl: snapshot.resolvedUrl,
              source,
            })
          },
          url: normalizedUrl,
        })

        if (
          capturedBrowserSnapshot !== null &&
          isExpectedBrowserSessionVacancyPage({
            originalUrl: normalizedUrl,
            resolvedUrl: capturedBrowserSnapshot.resolvedUrl,
            source,
          })
        ) {
          try {
            return await persistFetchedVacancyPage({
              fetchedPage: capturedBrowserSnapshot,
              generateId,
              getCurrentTimestamp,
              localAppData,
              normalizationService,
              originalUrl: normalizedUrl,
              source,
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
        }

        return await createInteractiveBrowserFallbackResult({
          getCurrentTimestamp,
          localAppData,
          originalUrl: normalizedUrl,
          source,
        })
      }

      await persistVacancyWorkspaceDraft({
        localAppData,
        url: normalizedUrl,
      })

      const fetchedPage = await fetchVacancyPage(normalizedUrl)

      return await persistFetchedVacancyPage({
        fetchedPage,
        generateId,
        getCurrentTimestamp,
        localAppData,
        normalizationService,
        originalUrl: normalizedUrl,
        source,
      })
    },
    openBrowserSession: async ({ url }: { url: string }): Promise<VacancyIngestResult> => {
      const normalizedUrl = requireUrl(url)
      const source = classifyVacancyUrl(normalizedUrl)
      const browserSnapshot = await openVacancyBrowserSession({
        shouldCapturePage: (snapshot) => {
          return isExpectedBrowserSessionVacancyPage({
            originalUrl: normalizedUrl,
            resolvedUrl: snapshot.resolvedUrl,
            source,
          })
        },
        url: normalizedUrl,
      })

      if (
        browserSnapshot === null ||
        !isExpectedBrowserSessionVacancyPage({
          originalUrl: normalizedUrl,
          resolvedUrl: browserSnapshot.resolvedUrl,
          source,
        })
      ) {
        const incompleteVacancy = createBlockedVacancySummary({
          blockingReason:
            'Close the internal browser session after the vacancy page loads, or paste the full job text instead.',
          fetchedAt: getCurrentTimestamp(),
          inputType: 'url',
          originalUrl: normalizedUrl,
          source,
        })

        await persistVacancyWorkspaceDraft({
          localAppData,
          url: normalizedUrl,
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
    blockingReason:
      'Open the internal browser session for authenticated pages, or paste the full job text instead.',
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
}): Promise<VacancyIngestResult> {
  const normalizedVacancy = await normalizationService.normalizeVacancy({
    html: fetchedPage.html,
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
    blockingReason = 'Add the full job responsibilities or requirements before adapting this CV.'
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
      text: '',
      url: originalUrl,
      vacancyId,
    } satisfies VacancyDraftMetadataValue,
  })

  return {
    kind: canGenerate ? 'ingested' : 'incomplete',
    vacancy,
    workspaceState: await thisGetWorkspaceState(localAppData),
  }
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
      vacancy: null,
    }
  }

  const vacancyRecord = await localAppData.metadata.get<VacancyMetadataValue>({
    id: draftRecord.vacancyId,
    scope: VACANCY_SCOPE,
  })

  return {
    draft: {
      text: draftRecord.text,
      url: draftRecord.url,
    },
    vacancy: vacancyRecord
      ? toVacancySummary({
          id: draftRecord.vacancyId,
          metadata: vacancyRecord,
        })
      : null,
  }
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
      text: '',
      url,
      vacancyId: null,
    } satisfies VacancyDraftMetadataValue,
  })
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

function classifyVacancyUrl(url: string): VacancySource {
  const hostname = new URL(url).hostname.toLowerCase()

  if (hostname.includes('greenhouse.io')) {
    return 'greenhouse'
  }

  if (hostname.includes('linkedin.com')) {
    return 'linkedin'
  }

  if (hostname.includes('indeed.com')) {
    return 'indeed'
  }

  return 'generic'
}

function isExpectedBrowserSessionVacancyPage({
  originalUrl,
  resolvedUrl,
  source,
}: {
  originalUrl: string
  resolvedUrl: string
  source: VacancySource
}): boolean {
  if (source !== 'linkedin' && source !== 'indeed') {
    return true
  }

  try {
    const requestedUrl = new URL(originalUrl)
    const currentUrl = new URL(resolvedUrl)

    if (source === 'linkedin') {
      return extractLinkedInJobId(currentUrl) === extractLinkedInJobId(requestedUrl)
    }

    return extractIndeedJobKey(currentUrl) === extractIndeedJobKey(requestedUrl)
  } catch {
    return false
  }
}

function extractLinkedInJobId(url: URL): string | null {
  const pathMatch = /^\/jobs\/view\/(\d+)/.exec(url.pathname)

  if (pathMatch?.[1] !== undefined) {
    return pathMatch[1]
  }

  const currentJobId = url.searchParams.get('currentJobId')

  if (currentJobId === null || currentJobId.trim() === '') {
    return null
  }

  return currentJobId
}

function extractIndeedJobKey(url: URL): string | null {
  const jobKey = url.searchParams.get('jk')

  if (jobKey === null || jobKey.trim() === '') {
    return null
  }

  return jobKey
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

async function fetchVacancyPageFromNetwork(url: string): Promise<{
  html: string
  pageTitle: string | null
  resolvedUrl: string
}> {
  const abortController = new AbortController()
  const timeoutId = setTimeout(() => {
    abortController.abort()
  }, VACANCY_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: abortController.signal,
    })

    if (!response.ok) {
      throw new Error(
        `Failed to fetch vacancy page: ${String(response.status)} ${response.statusText}`,
      )
    }

    const html = await response.text()

    return {
      html,
      pageTitle: inferPageTitle(html),
      resolvedUrl: response.url,
    }
  } finally {
    clearTimeout(timeoutId)
  }
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
