import { randomUUID } from 'node:crypto'

import type {
  VacancyIngestResult,
  VacancyInputType,
  VacancySource,
  VacancySummary,
  VacancyWorkspaceState,
} from '../shared/vacancy.js'
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js'

const VACANCY_DRAFT_SCOPE = 'vacancy-workspace'
const VACANCY_FETCH_TIMEOUT_MS = 15_000
const VACANCY_SCOPE = 'vacancies'
const VACANCY_WORKSPACE_RECORD_ID = 'current'

interface VacancyServiceDependencies {
  fetchVacancyPage?: (url: string) => Promise<{
    html: string
    pageTitle: string | null
    resolvedUrl: string
  }>
  generateId?: () => string
  getCurrentTimestamp?: () => string
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>
  openVacancyBrowserSession: (url: string) => Promise<void>
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
  getWorkspaceState: () => Promise<VacancyWorkspaceState>
  ingestPastedVacancy: (input: { text: string; url?: string }) => Promise<VacancyIngestResult>
  ingestVacancyUrl: (input: { url: string }) => Promise<VacancyIngestResult>
  openBrowserSession: (input: { url: string }) => Promise<void>
}

interface NormalizedVacancy {
  bodyText: string
  employer: string | null
  location: string | null
  requirements: string[]
  responsibilities: string[]
  title: string | null
}

export function createVacancyService({
  fetchVacancyPage = fetchVacancyPageFromNetwork,
  generateId = randomUUID,
  getCurrentTimestamp = () => {
    return new Date().toISOString()
  },
  localAppData,
  openVacancyBrowserSession,
}: VacancyServiceDependencies): VacancyService {
  return {
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
      const canGenerate = isVacancyReady(normalizedVacancy)
      const blockingReason = canGenerate
        ? null
        : 'Add the full job responsibilities or requirements before adapting this CV.'
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
        const incompleteVacancy = createBlockedVacancySummary({
          blockingReason:
            'Open the internal browser session for authenticated pages, or paste the full job text instead.',
          fetchedAt: getCurrentTimestamp(),
          inputType: 'url',
          originalUrl: normalizedUrl,
          source,
        })

        await localAppData.metadata.put({
          id: VACANCY_WORKSPACE_RECORD_ID,
          scope: VACANCY_DRAFT_SCOPE,
          value: {
            text: '',
            url: normalizedUrl,
            vacancyId: null,
          } satisfies VacancyDraftMetadataValue,
        })

        return {
          kind: 'incomplete',
          vacancy: incompleteVacancy,
          workspaceState: await thisGetWorkspaceState(localAppData),
        }
      }

      const fetchedPage = await fetchVacancyPage(normalizedUrl)
      const extractedText = extractTextFromHtml(fetchedPage.html)
      const normalizedVacancy = normalizeVacancyText(extractedText)
      const vacancyId = generateId()
      const fetchedAt = getCurrentTimestamp()
      const canGenerate = isVacancyReady(normalizedVacancy)
      const blockingReason = canGenerate ? null : detectIncompleteVacancyReason(extractedText)
      let incompletePreview: ReturnType<typeof createIncompleteExtractedPreview> | null = null

      if (blockingReason !== null) {
        incompletePreview = createIncompleteExtractedPreview({
          blockingReason,
          extractedText,
          pageTitle: fetchedPage.pageTitle,
        })
      }
      const vacancy = toVacancySummary({
        id: vacancyId,
        metadata: {
          blockingReason:
            incompletePreview === null ? blockingReason : incompletePreview.blockingReason,
          canGenerate,
          employer:
            incompletePreview === null ? normalizedVacancy.employer : incompletePreview.employer,
          fetchedAt,
          inputType: 'url',
          location:
            incompletePreview === null ? normalizedVacancy.location : incompletePreview.location,
          originalUrl: normalizedUrl,
          requirements:
            incompletePreview === null
              ? normalizedVacancy.requirements
              : incompletePreview.requirements,
          resolvedUrl: fetchedPage.resolvedUrl,
          responsibilities:
            incompletePreview === null
              ? normalizedVacancy.responsibilities
              : incompletePreview.responsibilities,
          source,
          status: canGenerate ? 'ready' : 'incomplete',
          textPreview:
            incompletePreview === null
              ? normalizedVacancy.bodyText.slice(0, 280)
              : incompletePreview.textPreview,
          title:
            incompletePreview === null
              ? (normalizedVacancy.title ?? inferTitleFromPageTitle(fetchedPage.pageTitle))
              : incompletePreview.title,
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
          url: normalizedUrl,
          vacancyId,
        } satisfies VacancyDraftMetadataValue,
      })

      return {
        kind: canGenerate ? 'ingested' : 'incomplete',
        vacancy,
        workspaceState: await thisGetWorkspaceState(localAppData),
      }
    },
    openBrowserSession: async ({ url }: { url: string }): Promise<void> => {
      await openVacancyBrowserSession(url)
    },
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

function detectIncompleteVacancyReason(extractedText: string): string {
  const normalizedText = extractedText.toLowerCase()

  if (
    normalizedText.includes('cookie') &&
    (normalizedText.includes('accept') || normalizedText.includes('consent'))
  ) {
    return 'This vacancy page looks incomplete because it only exposed a cookie banner or placeholder content.'
  }

  if (
    normalizedText.includes('sign in') ||
    normalizedText.includes('log in') ||
    normalizedText.includes('join linkedin')
  ) {
    return 'This vacancy page looks incomplete because it only exposed a sign-in wall.'
  }

  if (normalizedText.trim() === '') {
    return 'This vacancy page looked empty after extraction.'
  }

  return 'This vacancy page did not include enough responsibilities or requirements to continue.'
}

function createIncompleteExtractedPreview({
  blockingReason,
  extractedText,
  pageTitle,
}: {
  blockingReason: string
  extractedText: string
  pageTitle: string | null
}): {
  blockingReason: string
  employer: string | null
  location: string | null
  requirements: string[]
  responsibilities: string[]
  textPreview: string
  title: string | null
} {
  const trimmedText = extractedText.trim()

  return {
    blockingReason,
    employer: null,
    location: null,
    requirements: [],
    responsibilities: [],
    textPreview: trimmedText.replaceAll(/\s+/g, ' ').slice(0, 280),
    title: pageTitle,
  }
}

function extractTextFromHtml(html: string): string {
  const strippedHtml = html
    .replaceAll(/<head[\s\S]*?<\/head>/gi, ' ')
    .replaceAll(/<script[\s\S]*?<\/script>/gi, ' ')
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|br)>/gi, '\n')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/&nbsp;/gi, ' ')
    .replaceAll(/&amp;/gi, '&')
    .replaceAll(/&quot;/gi, '"')
    .replaceAll(/&#39;/gi, "'")
    .replaceAll(/\s+\n/g, '\n')
    .replaceAll(/\n{2,}/g, '\n')

  return strippedHtml.trim()
}

function sanitizeSnapshotHtml(html: string): string {
  return html.replaceAll(/localStorage|sessionStorage|document\.cookie/gi, '')
}

function inferPageTitle(html: string): string | null {
  const titleMatch = /<title>([^<]+)<\/title>/i.exec(html)

  if (titleMatch === null) {
    return null
  }

  const [, title] = titleMatch

  if (title === undefined) {
    return null
  }

  return title.trim()
}

function inferTitleFromPageTitle(pageTitle: string | null): string | null {
  if (pageTitle === null) {
    return null
  }

  const normalizedTitle = pageTitle
    .replace(/\s+-\s+Greenhouse$/i, '')
    .replace(/\s+\|\s+Indeed$/i, '')
    .replace(/\s+\|\s+LinkedIn$/i, '')
    .split(/\s+(?:at|\|)\s+/i)[0]

  if (normalizedTitle === undefined) {
    return null
  }

  return normalizedTitle.trim()
}
