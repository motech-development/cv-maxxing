import { randomUUID } from 'node:crypto'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type {
  CompletePendingGenerationResult,
  PendingGenerationCommand,
  ResumePendingGenerationResult,
  StartPendingGenerationInput,
} from '../shared/pending-generation.js'
import type { OriginalCvSummary } from '../shared/original-cv.js'
import type {
  AdaptationSummaryModel,
  AdaptedCvExperienceEntry,
  AdaptedCvModel,
  AdaptedCvSkill,
  CoverLetterModel,
  GeneratedAdaptedCvModel,
  GroundedText,
  TailoredApplicationExportResult,
  TailoredApplicationGenerationResult,
  TailoredApplicationPreview,
  TailoredApplicationWorkspaceState,
} from '../shared/tailored-application.js'
import type { WorkspaceSelection } from '../shared/workspace-selection.js'
import type { VacancyDraft, VacancySummary } from '../shared/vacancy.js'
import {
  ORIGINAL_CV_LANGUAGE_BLOCK_MESSAGE,
  VACANCY_LANGUAGE_BLOCK_MESSAGE,
  assessEnglishLanguageSupport,
} from '../shared/language-support.js'
import type { AiWorkerPreflightService } from './ai-worker-preflight-service.js'
import type { AiWorkerReadinessStore } from './ai-worker-readiness-store.js'
import { buildAdaptedCvExportFilename, resolveUniqueExportFilePath } from './adapted-cv-document.js'
import type { NormalizedOriginalCv } from './original-cv-normalization-service.js'
import { buildCoverLetterExportFilename } from './cover-letter-document.js'
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js'
import {
  parseWritingStyleProfileJson,
  type WritingStyleProfile,
} from './tailored-application-style-validator.js'
import type { WorkspaceSelectionStore } from './workspace-selection-store.js'

const ORIGINAL_CV_SCOPE = 'original-cvs'
const VACANCY_SCOPE = 'vacancies'
const VACANCY_WORKSPACE_SCOPE = 'vacancy-workspace'
const VACANCY_WORKSPACE_ENTRY_ID = 'current'
const PENDING_GENERATION_SESSION_SCOPE = 'pending-generation-session'
const PENDING_GENERATION_SESSION_ENTRY_ID = 'active-session'
const TAILORED_APPLICATION_SCOPE = 'tailored-applications'
const GENERATION_RUN_SCOPE = 'generation-runs'
const ADAPTED_CV_PDF_ARTIFACT_NAME = 'adapted-cv.pdf'
const COVER_LETTER_PDF_ARTIFACT_NAME = 'cover-letter.pdf'
const TAILORED_APPLICATION_CONTRACT_ERROR_MESSAGE =
  "We couldn't finish your CV and cover letter. Try tailoring this job again."
const TAILORING_TIMEOUT_MESSAGE = 'Tailoring your CV took too long. Try again.'
const TAILORING_FAILURE_MESSAGE = "We couldn't tailor your CV right now. Try again."
const MAX_HEADER_INTRO_LENGTH = 180
const MAX_PROFILE_SUMMARY_LENGTH = 900
const MAX_TAILORED_APPLICATION_SOURCE_TEXT_LENGTH = 24_000

export interface TailoredApplicationGenerationWorker {
  runGeneration: (input: {
    runDirectoryPath: string
    signal: AbortSignal
  }) => Promise<TailoredApplicationGenerationResult>
}

export interface TailoredApplicationSessionService {
  abandonPendingGeneration: () => Promise<void>
  completePendingGeneration: (commandId: string) => Promise<CompletePendingGenerationResult>
  deleteTailoredApplication: (tailoredApplicationId: string) => Promise<void>
  exportAdaptedCvPdf: (
    tailoredApplicationId: string,
  ) => Promise<TailoredApplicationExportResult | null>
  exportCoverLetterPdf: (
    tailoredApplicationId: string,
  ) => Promise<TailoredApplicationExportResult | null>
  getPendingGenerationCommand: () => Promise<PendingGenerationCommand | null>
  getTailoredApplicationPreview: (
    tailoredApplicationId: string,
  ) => Promise<TailoredApplicationPreview | null>
  getWorkspaceState: () => Promise<TailoredApplicationWorkspaceState>
  recoverInterruptedGeneration: () => Promise<void>
  resumePendingGeneration: () => Promise<ResumePendingGenerationResult>
  setWorkspaceSelection: (selection: WorkspaceSelection) => Promise<void>
  startPendingGeneration: (input: StartPendingGenerationInput) => Promise<AiWorkerPreflightResult>
}

export interface AdaptedCvRenderer {
  renderAdaptedCvPdf: (input: {
    adaptedCv: AdaptedCvModel
    employer: string | null
    vacancyTitle: string | null
  }) => Promise<{
    appliedAdaptedCv?: AdaptedCvModel
    pageCount: number
    pageWarning: string | null
    pdfBytes: Uint8Array
  }>
}

export interface CoverLetterRenderer {
  renderCoverLetterPdf: (input: {
    coverLetter: CoverLetterModel
    employer: string | null
    vacancyTitle: string | null
  }) => Promise<{
    pageCount: number
    pageWarning: string | null
    pdfBytes: Uint8Array
  }>
}

interface TailoredApplicationExportDialog {
  showSaveDialog: (input: {
    defaultPath: string
    filters: {
      extensions: string[]
      name: string
    }[]
    title: string
  }) => Promise<{
    canceled: boolean
    filePath?: string
  }>
}

interface PendingGenerationSessionRecord extends Record<string, JsonValue> {
  commandId: string
  generationRunId: string | null
  stage: 'queued' | 'ready' | 'running'
  tailoredApplicationId: string | null
}

interface GenerationRunRecord extends Record<string, JsonValue> {
  finishedAt: string | null
  provider: 'codex'
  startedAt: string
  status: 'cancelled' | 'failed' | 'ready' | 'running'
  tailoredApplicationId: string
}

interface TailoredApplicationMetadataValue extends Record<string, JsonValue> {
  adaptedCvPageCount: number | null
  adaptedCvPageWarning: string | null
  candidateName: string | null
  coverLetterPageCount: number | null
  coverLetterPageWarning: string | null
  createdAt: string
  employer: string | null
  originalCvId: string
  status: 'generating' | 'ready'
  vacancyId: string
  vacancyTitle: string | null
}

interface OriginalCvMetadataValue extends Record<string, JsonValue> {
  fileType: 'docx' | 'pdf'
  headline: string
  id: string
  importedAt: string
  originalFilename: string
  pageCount: number
  summary: string
  writingStyle: {
    averageSentenceLength: number
    clicheDetections: string[]
    firstPersonUsage: 'absent' | 'mixed' | 'present'
    formality: 'conversational' | 'direct' | 'formal'
  }
}

interface VacancyMetadataValue extends Record<string, JsonValue> {
  blockingReason: string | null
  canGenerate: boolean
  employer: string | null
  fetchedAt: string
  inputType: 'pasted_text' | 'url'
  location: string | null
  originalUrl: string | null
  requirements: string[]
  resolvedUrl: string | null
  responsibilities: string[]
  source: 'generic' | 'greenhouse' | 'indeed' | 'linkedin'
  status: 'incomplete' | 'ready'
  textPreview: string
  title: string | null
}

interface VacancyWorkspaceMetadataValue extends Record<string, JsonValue> {
  reviewState: 'editable' | 'reviewed' | null
  text: string
  url: string
  vacancyId: string | null
}

interface ContractValidationFailureArtifact extends Record<string, JsonValue> {
  code: string
  detail: string | null
  invalidSection: JsonValue | null
  invalidSectionIndex: number | null
  path: string
}

interface CreateTailoredApplicationSessionServiceOptions {
  adaptedCvRenderer?: AdaptedCvRenderer
  aiWorker: Pick<AiWorkerPreflightService, 'retryAiWorkerPreflight'>
  coverLetterRenderer?: CoverLetterRenderer
  exportDialog?: TailoredApplicationExportDialog
  generateId?: () => string
  getCurrentTimestamp?: () => string
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'deleteScopedData' | 'metadata'>
  readinessStore: Pick<
    AiWorkerReadinessStore,
    | 'clearPendingGenerationCommand'
    | 'getPendingGenerationCommand'
    | 'savePendingGenerationCommand'
    | 'setStartupDestination'
    | 'getStartupDestination'
  >
  runWorkspaceRootPath: string
  worker?: TailoredApplicationGenerationWorker
  workspaceSelectionStore?: WorkspaceSelectionStore
}

interface OriginalCvContext {
  headline: string
  normalizedCv: NormalizedOriginalCv
  normalizedJson: string
  originalCvId: string
  originalCvText: string
  originalFilename: string
  writingStyleProfile: WritingStyleProfile
  writingStyleProfileJson: string
}

interface VacancyContext {
  employer: string | null
  normalizedJson: string
  title: string | null
  vacancyDraft: VacancyDraft
  vacancyId: string
  vacancyText: string
}

type TailoredApplicationContractErrorCode =
  | 'adaptation_summary_invalid'
  | 'adapted_cv_invalid'
  | 'cover_letter_invalid'
  | 'grounded_text_invalid'
  | 'tailored_application_result_invalid'

class TailoredApplicationContractValidationError extends Error {
  readonly code: TailoredApplicationContractErrorCode
  readonly detail?: string
  readonly path: string

  constructor({
    code,
    detail,
    path,
  }: {
    code: TailoredApplicationContractErrorCode
    detail?: string
    path: string
  }) {
    super(TAILORED_APPLICATION_CONTRACT_ERROR_MESSAGE)
    this.code = code
    this.detail = detail
    this.name = 'TailoredApplicationContractValidationError'
    this.path = path
  }
}

const missingGenerationWorker: TailoredApplicationGenerationWorker = {
  runGeneration: () => {
    return Promise.reject(new Error('No tailored-application generation worker is configured.'))
  },
}

const missingAdaptedCvRenderer: AdaptedCvRenderer = {
  renderAdaptedCvPdf: () => {
    return Promise.reject(new Error('No adapted-CV renderer is configured.'))
  },
}

const missingCoverLetterRenderer: CoverLetterRenderer = {
  renderCoverLetterPdf: () => {
    return Promise.reject(new Error('No cover-letter renderer is configured.'))
  },
}

function createTailoredApplicationTitle({
  employer,
  vacancyTitle,
}: {
  employer: string | null
  vacancyTitle: string | null
}): string {
  const normalizedVacancyTitle = vacancyTitle?.trim() ?? ''
  const normalizedEmployer = employer?.trim() ?? ''

  if (normalizedVacancyTitle !== '' && normalizedEmployer !== '') {
    return `${normalizedVacancyTitle} · ${normalizedEmployer}`
  }

  if (normalizedVacancyTitle !== '') {
    return normalizedVacancyTitle
  }

  if (normalizedEmployer !== '') {
    return `Saved job · ${normalizedEmployer}`
  }

  return 'Saved job'
}

function getInvalidAdaptedCvSectionIndex(detail: string | undefined): number | null {
  if (detail === undefined) {
    return null
  }

  const matchedSectionIndex = /adaptedCv\.sections\[(\d+)\]/u.exec(detail)

  if (matchedSectionIndex === null) {
    return null
  }

  const parsedSectionIndex = Number.parseInt(matchedSectionIndex[1] ?? '', 10)

  return Number.isInteger(parsedSectionIndex) ? parsedSectionIndex : null
}

function buildContractValidationFailureArtifact({
  error,
  rawResult,
}: {
  error: TailoredApplicationContractValidationError
  rawResult: TailoredApplicationGenerationResult
}): ContractValidationFailureArtifact {
  const invalidSectionIndex = getInvalidAdaptedCvSectionIndex(error.detail)
  const invalidSection =
    invalidSectionIndex === null
      ? null
      : ((rawResult.adaptedCv.sections[invalidSectionIndex] ?? null) as JsonValue | null)

  return {
    code: error.code,
    detail: error.detail ?? null,
    invalidSection,
    invalidSectionIndex,
    path: error.path,
  }
}

export function createTailoredApplicationSessionService({
  adaptedCvRenderer = missingAdaptedCvRenderer,
  aiWorker,
  coverLetterRenderer = missingCoverLetterRenderer,
  exportDialog,
  generateId = randomUUID,
  getCurrentTimestamp = () => {
    return new Date().toISOString()
  },
  localAppData,
  readinessStore,
  runWorkspaceRootPath,
  worker = missingGenerationWorker,
  workspaceSelectionStore,
}: CreateTailoredApplicationSessionServiceOptions): TailoredApplicationSessionService {
  let activeAbortController: AbortController | null = null
  let activeRunPromise: Promise<ResumePendingGenerationResult> | null = null

  async function resetPendingGenerationState(): Promise<void> {
    await clearPendingGenerationSession()
    await readinessStore.clearPendingGenerationCommand()
    await readinessStore.setStartupDestination('workspace')
  }

  async function clearPendingGenerationSession(): Promise<void> {
    await localAppData.metadata.delete({
      id: PENDING_GENERATION_SESSION_ENTRY_ID,
      scope: PENDING_GENERATION_SESSION_SCOPE,
    })
  }

  async function getPendingGenerationSession(): Promise<PendingGenerationSessionRecord | null> {
    const value = await localAppData.metadata.get({
      id: PENDING_GENERATION_SESSION_ENTRY_ID,
      scope: PENDING_GENERATION_SESSION_SCOPE,
    })

    if (!isPendingGenerationSessionRecord(value)) {
      return null
    }

    return value
  }

  async function savePendingGenerationSession(
    value: PendingGenerationSessionRecord,
  ): Promise<void> {
    await localAppData.metadata.put({
      id: PENDING_GENERATION_SESSION_ENTRY_ID,
      scope: PENDING_GENERATION_SESSION_SCOPE,
      value,
    })
  }

  async function loadOriginalCvContext(
    command: PendingGenerationCommand,
  ): Promise<OriginalCvContext> {
    const [
      originalCvMetadata,
      normalizedJsonBuffer,
      originalCvTextBuffer,
      writingStyleProfileBuffer,
    ] = await Promise.all([
      localAppData.metadata.get<OriginalCvMetadataValue>({
        id: command.originalCvId,
        scope: ORIGINAL_CV_SCOPE,
      }),
      localAppData.artifacts.read({
        id: command.originalCvId,
        name: 'normalized.json',
        scope: ORIGINAL_CV_SCOPE,
      }),
      localAppData.artifacts.read({
        id: command.originalCvId,
        name: 'extracted.txt',
        scope: ORIGINAL_CV_SCOPE,
      }),
      localAppData.artifacts.read({
        id: command.originalCvId,
        name: 'writing-style-profile.json',
        scope: ORIGINAL_CV_SCOPE,
      }),
    ])

    if (
      originalCvMetadata === null ||
      normalizedJsonBuffer === null ||
      originalCvTextBuffer === null ||
      writingStyleProfileBuffer === null
    ) {
      throw new Error('The selected original CV is incomplete or unavailable.')
    }

    if (assessEnglishLanguageSupport(originalCvTextBuffer.toString('utf8')).status === 'blocked') {
      throw new Error(ORIGINAL_CV_LANGUAGE_BLOCK_MESSAGE)
    }

    const normalizedJson = normalizedJsonBuffer.toString('utf8')

    return {
      headline: originalCvMetadata.headline,
      normalizedCv: parseNormalizedOriginalCvJson(normalizedJson),
      normalizedJson,
      originalCvId: command.originalCvId,
      originalCvText: originalCvTextBuffer.toString('utf8'),
      originalFilename: command.originalCvLabel,
      writingStyleProfile: parseWritingStyleProfileJson(writingStyleProfileBuffer.toString('utf8')),
      writingStyleProfileJson: writingStyleProfileBuffer.toString('utf8'),
    }
  }

  async function loadVacancyContext(command: PendingGenerationCommand): Promise<VacancyContext> {
    const [vacancyMetadata, vacancyWorkspace, normalizedJsonBuffer, vacancyTextBuffer] =
      await Promise.all([
        localAppData.metadata.get<VacancyMetadataValue>({
          id: command.vacancyId,
          scope: VACANCY_SCOPE,
        }),
        localAppData.metadata.get<VacancyWorkspaceMetadataValue>({
          id: VACANCY_WORKSPACE_ENTRY_ID,
          scope: VACANCY_WORKSPACE_SCOPE,
        }),
        localAppData.artifacts.read({
          id: command.vacancyId,
          name: 'normalized.json',
          scope: VACANCY_SCOPE,
        }),
        localAppData.artifacts.read({
          id: command.vacancyId,
          name: 'extracted.txt',
          scope: VACANCY_SCOPE,
        }),
      ])

    if (
      vacancyMetadata === null ||
      vacancyWorkspace?.vacancyId !== command.vacancyId ||
      resolveVacancyWorkspaceReviewState({
        vacancyMetadata,
        vacancyWorkspace,
      }) !== 'reviewed' ||
      normalizedJsonBuffer === null ||
      vacancyTextBuffer === null
    ) {
      throw new Error('The selected vacancy preview is incomplete or unavailable.')
    }

    if (!vacancyMetadata.canGenerate || vacancyMetadata.status !== 'ready') {
      throw new Error('Review a complete job before tailoring your CV.')
    }

    if (assessEnglishLanguageSupport(vacancyTextBuffer.toString('utf8')).status === 'blocked') {
      throw new Error(VACANCY_LANGUAGE_BLOCK_MESSAGE)
    }

    return {
      employer: vacancyMetadata.employer,
      normalizedJson: normalizedJsonBuffer.toString('utf8'),
      title: vacancyMetadata.title,
      vacancyDraft: {
        text: vacancyWorkspace.text,
        url: vacancyWorkspace.url,
      },
      vacancyId: command.vacancyId,
      vacancyText: vacancyTextBuffer.toString('utf8'),
    }
  }

  async function writeRunWorkspaceInput({
    command,
    originalCv,
    runDirectoryPath,
    vacancy,
  }: {
    command: PendingGenerationCommand
    originalCv: OriginalCvContext
    runDirectoryPath: string
    vacancy: VacancyContext
  }): Promise<void> {
    const inputDirectoryPath = path.join(runDirectoryPath, 'input')

    await mkdir(inputDirectoryPath, {
      recursive: true,
    })

    const taskJson = JSON.stringify({
      commandId: command.commandId,
      constraints: {
        outputLanguage: 'British English',
        workerMustNotFetchContext: true,
        workerMustNotGeneratePdf: true,
      },
      originalCv: {
        extractedTextPath: 'input/original-cv.txt',
        id: originalCv.originalCvId,
        normalizedJsonPath: 'input/original-cv.json',
        originalFilename: originalCv.originalFilename,
        writingStyleProfilePath: 'input/writing-style-profile.json',
      },
      outputContract: {
        adaptedCvArtifactName: 'adapted-cv.json',
        coverLetterArtifactName: 'cover-letter.json',
      },
      renderingContract: {
        workerMustNotGeneratePdf: true,
      },
      vacancy: {
        extractedTextPath: 'input/vacancy.txt',
        id: vacancy.vacancyId,
        normalizedJsonPath: 'input/vacancy.json',
      },
    })

    await Promise.all([
      writeFile(
        path.join(inputDirectoryPath, 'original-cv.json'),
        originalCv.normalizedJson,
        'utf8',
      ),
      writeFile(
        path.join(inputDirectoryPath, 'original-cv.txt'),
        boundTailoredApplicationSourceText(originalCv.originalCvText),
        'utf8',
      ),
      writeFile(
        path.join(inputDirectoryPath, 'writing-style-profile.json'),
        originalCv.writingStyleProfileJson,
        'utf8',
      ),
      writeFile(path.join(inputDirectoryPath, 'vacancy.json'), vacancy.normalizedJson, 'utf8'),
      writeFile(
        path.join(inputDirectoryPath, 'vacancy.txt'),
        boundTailoredApplicationSourceText(vacancy.vacancyText),
        'utf8',
      ),
      writeFile(path.join(inputDirectoryPath, 'task.json'), taskJson, 'utf8'),
    ])
  }

  async function persistReadyArtifacts({
    adaptedCv,
    adaptedCvPageCount,
    adaptedCvPageWarning,
    adaptedCvPdfBytes,
    coverLetterPageCount,
    coverLetterPageWarning,
    coverLetterPdfBytes,
    employer,
    originalCvId,
    result,
    tailoredApplicationId,
    timestamp,
    vacancyId,
    vacancyTitle,
  }: {
    adaptedCv: AdaptedCvModel
    adaptedCvPageCount: number
    adaptedCvPageWarning: string | null
    adaptedCvPdfBytes: Uint8Array
    coverLetterPageCount: number
    coverLetterPageWarning: string | null
    coverLetterPdfBytes: Uint8Array
    employer: string | null
    originalCvId: string
    result: TailoredApplicationGenerationResult
    tailoredApplicationId: string
    timestamp: string
    vacancyId: string
    vacancyTitle: string | null
  }): Promise<void> {
    const coverLetterPlainText = buildCoverLetterPlainText(result.coverLetter)

    await localAppData.metadata.put<TailoredApplicationMetadataValue>({
      id: tailoredApplicationId,
      scope: TAILORED_APPLICATION_SCOPE,
      value: {
        adaptedCvPageCount,
        adaptedCvPageWarning,
        candidateName: adaptedCv.candidateName,
        coverLetterPageCount,
        coverLetterPageWarning,
        createdAt: timestamp,
        employer,
        originalCvId,
        status: 'ready',
        vacancyId,
        vacancyTitle,
      },
    })
    await localAppData.artifacts.write({
      content: Buffer.from(JSON.stringify(adaptedCv), 'utf8'),
      id: tailoredApplicationId,
      name: 'adapted-cv.json',
      scope: TAILORED_APPLICATION_SCOPE,
    })
    await localAppData.artifacts.write({
      content: Buffer.from(adaptedCvPdfBytes),
      id: tailoredApplicationId,
      name: ADAPTED_CV_PDF_ARTIFACT_NAME,
      scope: TAILORED_APPLICATION_SCOPE,
    })
    await localAppData.artifacts.write({
      content: Buffer.from(JSON.stringify(result.coverLetter), 'utf8'),
      id: tailoredApplicationId,
      name: 'cover-letter.json',
      scope: TAILORED_APPLICATION_SCOPE,
    })
    await localAppData.artifacts.write({
      content: Buffer.from(coverLetterPdfBytes),
      id: tailoredApplicationId,
      name: COVER_LETTER_PDF_ARTIFACT_NAME,
      scope: TAILORED_APPLICATION_SCOPE,
    })
    await localAppData.artifacts.write({
      content: Buffer.from(coverLetterPlainText, 'utf8'),
      id: tailoredApplicationId,
      name: 'cover-letter.txt',
      scope: TAILORED_APPLICATION_SCOPE,
    })
    await localAppData.artifacts.write({
      content: Buffer.from(JSON.stringify(result.adaptationSummary), 'utf8'),
      id: tailoredApplicationId,
      name: 'adaptation-summary.json',
      scope: TAILORED_APPLICATION_SCOPE,
    })
  }

  async function persistGeneratingArtifacts({
    originalCvId,
    tailoredApplicationId,
    timestamp,
    vacancyId,
  }: {
    originalCvId: string
    tailoredApplicationId: string
    timestamp: string
    vacancyId: string
  }): Promise<void> {
    await localAppData.metadata.put<TailoredApplicationMetadataValue>({
      id: tailoredApplicationId,
      scope: TAILORED_APPLICATION_SCOPE,
      value: {
        adaptedCvPageCount: null,
        adaptedCvPageWarning: null,
        candidateName: null,
        coverLetterPageCount: null,
        coverLetterPageWarning: null,
        createdAt: timestamp,
        employer: null,
        originalCvId,
        status: 'generating',
        vacancyId,
        vacancyTitle: null,
      },
    })
  }

  async function getReadyTailoredApplicationMetadata(
    tailoredApplicationId: string,
  ): Promise<TailoredApplicationMetadataValue | null> {
    const metadata = await localAppData.metadata.get<TailoredApplicationMetadataValue>({
      id: tailoredApplicationId,
      scope: TAILORED_APPLICATION_SCOPE,
    })

    if (metadata?.status !== 'ready') {
      return null
    }

    return metadata
  }

  async function getOriginalCvSummary(
    localAppData: Pick<LocalAppDataStore, 'metadata'>,
    originalCvId: string,
  ): Promise<OriginalCvSummary | null> {
    const originalCvMetadata = await localAppData.metadata.get<OriginalCvMetadataValue>({
      id: originalCvId,
      scope: ORIGINAL_CV_SCOPE,
    })

    if (originalCvMetadata === null) {
      return null
    }

    const snapshotRecords =
      await localAppData.metadata.list<OriginalCvMetadataValue>(ORIGINAL_CV_SCOPE)

    return {
      fileType: originalCvMetadata.fileType,
      headline: originalCvMetadata.headline,
      id: originalCvId,
      importedAt: originalCvMetadata.importedAt,
      originalFilename: originalCvMetadata.originalFilename,
      pageCount: originalCvMetadata.pageCount,
      snapshotCount: snapshotRecords.length,
      summary: originalCvMetadata.summary,
      writingStyle: originalCvMetadata.writingStyle,
    }
  }

  async function getVacancySummary(
    localAppData: Pick<LocalAppDataStore, 'metadata'>,
    vacancyId: string,
  ): Promise<VacancySummary | null> {
    const vacancyMetadata = await localAppData.metadata.get<VacancyMetadataValue>({
      id: vacancyId,
      scope: VACANCY_SCOPE,
    })

    if (vacancyMetadata === null) {
      return null
    }

    return {
      blockingReason: vacancyMetadata.blockingReason,
      canGenerate: vacancyMetadata.canGenerate,
      employer: vacancyMetadata.employer,
      fetchedAt: vacancyMetadata.fetchedAt,
      id: vacancyId,
      inputType: vacancyMetadata.inputType,
      location: vacancyMetadata.location,
      originalUrl: vacancyMetadata.originalUrl,
      requirements: vacancyMetadata.requirements,
      resolvedUrl: vacancyMetadata.resolvedUrl,
      responsibilities: vacancyMetadata.responsibilities,
      source: vacancyMetadata.source,
      status: vacancyMetadata.status,
      textPreview: vacancyMetadata.textPreview,
      title: vacancyMetadata.title,
    }
  }

  async function exportPdfArtifact({
    artifactName,
    defaultFilename,
    pageWarning,
    tailoredApplicationId,
    title,
  }: {
    artifactName: string
    defaultFilename: string
    pageWarning: string | null
    tailoredApplicationId: string
    title: string
  }): Promise<TailoredApplicationExportResult | null> {
    const pdfBytes = await localAppData.artifacts.read({
      id: tailoredApplicationId,
      name: artifactName,
      scope: TAILORED_APPLICATION_SCOPE,
    })

    if (pdfBytes === null || exportDialog === undefined) {
      return null
    }

    const dialogResult = await exportDialog.showSaveDialog({
      defaultPath: defaultFilename,
      filters: [
        {
          extensions: ['pdf'],
          name: 'PDF',
        },
      ],
      title,
    })

    if (dialogResult.canceled || dialogResult.filePath === undefined) {
      return null
    }

    const resolvedPath = await resolveUniqueExportFilePath(
      dialogResult.filePath,
      async (candidatePath) => {
        try {
          await access(candidatePath)

          return true
        } catch {
          return false
        }
      },
    )

    await writeFile(resolvedPath, pdfBytes)

    return {
      filePath: resolvedPath,
      overwriteAvoided: resolvedPath !== dialogResult.filePath,
      pageWarning,
    }
  }

  async function removeRunWorkspace(generationRunId: string): Promise<void> {
    await rm(path.join(runWorkspaceRootPath, generationRunId), {
      force: true,
      recursive: true,
    })
  }

  async function persistContractValidationFailureArtifacts({
    error,
    generationRunId,
    rawResult,
  }: {
    error: TailoredApplicationContractValidationError
    generationRunId: string
    rawResult: TailoredApplicationGenerationResult
  }): Promise<void> {
    const contractValidationFailureArtifact = buildContractValidationFailureArtifact({
      error,
      rawResult,
    })

    console.error(
      `Tailored application contract validation failed for generation run ${generationRunId}: ${JSON.stringify(
        contractValidationFailureArtifact,
      )}`,
    )

    await Promise.all([
      localAppData.artifacts.write({
        content: Buffer.from(JSON.stringify(rawResult), 'utf8'),
        id: generationRunId,
        name: 'raw-generation-result.json',
        scope: GENERATION_RUN_SCOPE,
      }),
      localAppData.artifacts.write({
        content: Buffer.from(JSON.stringify(contractValidationFailureArtifact), 'utf8'),
        id: generationRunId,
        name: 'contract-validation-error.json',
        scope: GENERATION_RUN_SCOPE,
      }),
    ])
  }

  async function runPendingGeneration(
    command: PendingGenerationCommand,
  ): Promise<ResumePendingGenerationResult> {
    const pendingSession = await getPendingGenerationSession()

    if (pendingSession?.stage === 'ready') {
      if (
        pendingSession.generationRunId === null ||
        pendingSession.tailoredApplicationId === null
      ) {
        throw new Error('The pending generation session is incomplete.')
      }

      return {
        generationRunId: pendingSession.generationRunId,
        tailoredApplicationId: pendingSession.tailoredApplicationId,
      }
    }

    const generationRunId = pendingSession?.generationRunId ?? generateId()
    const tailoredApplicationId = pendingSession?.tailoredApplicationId ?? generateId()
    const runDirectoryPath = path.join(runWorkspaceRootPath, generationRunId)
    const timestamp = getCurrentTimestamp()
    const originalCv = await loadOriginalCvContext(command)
    const vacancy = await loadVacancyContext(command)

    await persistGeneratingArtifacts({
      originalCvId: command.originalCvId,
      tailoredApplicationId,
      timestamp,
      vacancyId: command.vacancyId,
    })
    await localAppData.metadata.put<GenerationRunRecord>({
      id: generationRunId,
      scope: GENERATION_RUN_SCOPE,
      value: {
        finishedAt: null,
        provider: 'codex',
        startedAt: timestamp,
        status: 'running',
        tailoredApplicationId,
      },
    })
    await savePendingGenerationSession({
      commandId: command.commandId,
      generationRunId,
      stage: 'running',
      tailoredApplicationId,
    })
    await writeRunWorkspaceInput({
      command,
      originalCv,
      runDirectoryPath,
      vacancy,
    })

    let rawResult: TailoredApplicationGenerationResult | null = null

    try {
      rawResult = await worker.runGeneration({
        runDirectoryPath,
        signal: activeAbortController?.signal ?? new AbortController().signal,
      })
      const result = normalizeTailoredApplicationGenerationResult(rawResult, {
        originalCvHeadline: originalCv.headline,
        vacancyTitle: vacancy.title,
      })

      validateTailoredApplicationGenerationResult(result, {
        originalCvHeadline: originalCv.headline,
        originalCvExperience: originalCv.normalizedCv.experience,
        vacancyTitle: vacancy.title,
      })
      const renderReadyAdaptedCv = buildAdaptedCvModel({
        generatedAdaptedCv: result.adaptedCv,
        originalCv: originalCv.normalizedCv,
      })
      const [renderedAdaptedCv, renderedCoverLetter] = await Promise.all([
        adaptedCvRenderer.renderAdaptedCvPdf({
          adaptedCv: renderReadyAdaptedCv,
          employer: vacancy.employer,
          vacancyTitle: vacancy.title,
        }),
        coverLetterRenderer.renderCoverLetterPdf({
          coverLetter: result.coverLetter,
          employer: vacancy.employer,
          vacancyTitle: vacancy.title,
        }),
      ])
      const persistedAdaptedCv = renderedAdaptedCv.appliedAdaptedCv ?? renderReadyAdaptedCv
      await persistReadyArtifacts({
        adaptedCvPageCount: renderedAdaptedCv.pageCount,
        adaptedCvPageWarning: renderedAdaptedCv.pageWarning,
        adaptedCvPdfBytes: renderedAdaptedCv.pdfBytes,
        coverLetterPageCount: renderedCoverLetter.pageCount,
        coverLetterPageWarning: renderedCoverLetter.pageWarning,
        coverLetterPdfBytes: renderedCoverLetter.pdfBytes,
        employer: vacancy.employer,
        originalCvId: command.originalCvId,
        adaptedCv: persistedAdaptedCv,
        result,
        tailoredApplicationId,
        timestamp,
        vacancyId: command.vacancyId,
        vacancyTitle: vacancy.title,
      })
      await localAppData.metadata.put<GenerationRunRecord>({
        id: generationRunId,
        scope: GENERATION_RUN_SCOPE,
        value: {
          finishedAt: getCurrentTimestamp(),
          provider: 'codex',
          startedAt: timestamp,
          status: 'ready',
          tailoredApplicationId,
        },
      })
      await savePendingGenerationSession({
        commandId: command.commandId,
        generationRunId,
        stage: 'ready',
        tailoredApplicationId,
      })

      return {
        generationRunId,
        tailoredApplicationId,
      }
    } catch (error) {
      await localAppData.deleteScopedData({
        id: tailoredApplicationId,
        scope: TAILORED_APPLICATION_SCOPE,
      })
      await localAppData.metadata.put<GenerationRunRecord>({
        id: generationRunId,
        scope: GENERATION_RUN_SCOPE,
        value: {
          finishedAt: getCurrentTimestamp(),
          provider: 'codex',
          startedAt: timestamp,
          status: activeAbortController?.signal.aborted === true ? 'cancelled' : 'failed',
          tailoredApplicationId,
        },
      })
      await resetPendingGenerationState()

      if (activeAbortController?.signal.aborted === true) {
        throw new Error('Generation cancelled.')
      }

      if (error instanceof Error && error instanceof TailoredApplicationContractValidationError) {
        if (rawResult !== null) {
          await persistContractValidationFailureArtifacts({
            error,
            generationRunId,
            rawResult,
          })
        }

        throw error
      }

      if (
        error instanceof Error &&
        error.message === 'Tailored application generation timed out.'
      ) {
        throw new Error(TAILORING_TIMEOUT_MESSAGE, {
          cause: error,
        })
      }

      throw new Error(TAILORING_FAILURE_MESSAGE, {
        cause: error,
      })
    } finally {
      await removeRunWorkspace(generationRunId)
    }
  }

  async function getWorkspaceState(): Promise<TailoredApplicationWorkspaceState> {
    const metadataRecords = await localAppData.metadata.list<TailoredApplicationMetadataValue>(
      TAILORED_APPLICATION_SCOPE,
    )
    const readyApplications = metadataRecords
      .filter((record) => {
        return record.value.status === 'ready'
      })
      .toSorted((leftRecord, rightRecord) => {
        return rightRecord.value.createdAt.localeCompare(leftRecord.value.createdAt)
      })
      .map((record) => {
        return {
          createdAt: record.value.createdAt,
          employer: record.value.employer,
          id: record.id,
          pageCount: record.value.adaptedCvPageCount ?? 1,
          pageWarning: record.value.adaptedCvPageWarning,
          title: createTailoredApplicationTitle(record.value),
          vacancyTitle: record.value.vacancyTitle,
        }
      })
    const [hasMeaningfulDraft, persistedSelection] = await Promise.all([
      hasMeaningfulVacancyDraft(localAppData),
      workspaceSelectionStore?.getSelection() ?? Promise.resolve(null),
    ])

    return {
      activeApplicationId: resolveSelectedTailoredApplicationId({
        applications: readyApplications,
        hasMeaningfulDraft,
        selection: persistedSelection,
      }),
      applications: readyApplications,
    }
  }

  return {
    abandonPendingGeneration: async () => {
      const pendingSession = await getPendingGenerationSession()

      activeAbortController?.abort()

      if (
        pendingSession?.tailoredApplicationId !== null &&
        pendingSession?.tailoredApplicationId !== undefined
      ) {
        await localAppData.deleteScopedData({
          id: pendingSession.tailoredApplicationId,
          scope: TAILORED_APPLICATION_SCOPE,
        })
      }

      if (
        pendingSession?.generationRunId !== null &&
        pendingSession?.generationRunId !== undefined
      ) {
        await removeRunWorkspace(pendingSession.generationRunId)
      }

      await resetPendingGenerationState()
    },
    completePendingGeneration: async (commandId) => {
      const [pendingGenerationCommand, pendingSession] = await Promise.all([
        readinessStore.getPendingGenerationCommand(),
        getPendingGenerationSession(),
      ])

      if (pendingGenerationCommand?.commandId !== commandId || pendingSession?.stage !== 'ready') {
        throw new Error('Pending generation command mismatch.')
      }

      await clearPendingGenerationSession()
      await readinessStore.clearPendingGenerationCommand()
      try {
        await localAppData.metadata.delete({
          id: VACANCY_WORKSPACE_ENTRY_ID,
          scope: VACANCY_WORKSPACE_SCOPE,
        })
      } catch {
        // Best-effort cleanup. A completed tailored application should still open.
      }
      await readinessStore.setStartupDestination('workspace')

      if (pendingSession.tailoredApplicationId !== null) {
        await workspaceSelectionStore?.setSelection({
          kind: 'tailored_application',
          tailoredApplicationId: pendingSession.tailoredApplicationId,
        })
      }

      return {
        workspaceState: await getWorkspaceState(),
      }
    },
    deleteTailoredApplication: async (tailoredApplicationId) => {
      await localAppData.deleteScopedData({
        id: tailoredApplicationId,
        scope: TAILORED_APPLICATION_SCOPE,
      })

      const generationRunRecords =
        await localAppData.metadata.list<GenerationRunRecord>(GENERATION_RUN_SCOPE)

      await Promise.all(
        generationRunRecords
          .filter((record) => {
            return record.value.tailoredApplicationId === tailoredApplicationId
          })
          .map(async (record) => {
            await localAppData.metadata.delete({
              id: record.id,
              scope: GENERATION_RUN_SCOPE,
            })
          }),
      )

      const persistedSelection = await workspaceSelectionStore?.getSelection()

      if (
        persistedSelection?.kind === 'tailored_application' &&
        persistedSelection.tailoredApplicationId === tailoredApplicationId
      ) {
        const [hasMeaningfulDraft, workspaceState] = await Promise.all([
          hasMeaningfulVacancyDraft(localAppData),
          getWorkspaceState(),
        ])

        await workspaceSelectionStore?.setSelection(
          resolveNextWorkspaceSelection({
            applications: workspaceState.applications,
            hasMeaningfulDraft,
          }),
        )
      }
    },
    exportAdaptedCvPdf: async (tailoredApplicationId) => {
      const metadata = await getReadyTailoredApplicationMetadata(tailoredApplicationId)

      if (metadata === null) {
        return null
      }

      return await exportPdfArtifact({
        artifactName: ADAPTED_CV_PDF_ARTIFACT_NAME,
        defaultFilename: buildAdaptedCvExportFilename({
          candidateName: metadata.candidateName ?? 'adapted-cv',
          vacancyTitle: metadata.vacancyTitle,
        }),
        pageWarning: metadata.adaptedCvPageWarning,
        tailoredApplicationId,
        title: 'Export adapted CV PDF',
      })
    },
    exportCoverLetterPdf: async (tailoredApplicationId) => {
      const metadata = await getReadyTailoredApplicationMetadata(tailoredApplicationId)

      if (metadata === null) {
        return null
      }

      return await exportPdfArtifact({
        artifactName: COVER_LETTER_PDF_ARTIFACT_NAME,
        defaultFilename: buildCoverLetterExportFilename({
          candidateName: metadata.candidateName ?? 'cover-letter',
          vacancyTitle: metadata.vacancyTitle,
        }),
        pageWarning: metadata.coverLetterPageWarning,
        tailoredApplicationId,
        title: 'Export cover letter PDF',
      })
    },
    getPendingGenerationCommand: async () => {
      return await readinessStore.getPendingGenerationCommand()
    },
    getTailoredApplicationPreview: async (tailoredApplicationId) => {
      const metadata = await getReadyTailoredApplicationMetadata(tailoredApplicationId)

      if (metadata === null) {
        return null
      }

      const [
        adaptedCvPdfBytes,
        adaptationSummaryBytes,
        coverLetterPdfBytes,
        coverLetterPlainTextBytes,
        originalCv,
        vacancy,
      ] = await Promise.all([
        localAppData.artifacts.read({
          id: tailoredApplicationId,
          name: ADAPTED_CV_PDF_ARTIFACT_NAME,
          scope: TAILORED_APPLICATION_SCOPE,
        }),
        localAppData.artifacts.read({
          id: tailoredApplicationId,
          name: 'adaptation-summary.json',
          scope: TAILORED_APPLICATION_SCOPE,
        }),
        localAppData.artifacts.read({
          id: tailoredApplicationId,
          name: COVER_LETTER_PDF_ARTIFACT_NAME,
          scope: TAILORED_APPLICATION_SCOPE,
        }),
        localAppData.artifacts.read({
          id: tailoredApplicationId,
          name: 'cover-letter.txt',
          scope: TAILORED_APPLICATION_SCOPE,
        }),
        getOriginalCvSummary(localAppData, metadata.originalCvId),
        getVacancySummary(localAppData, metadata.vacancyId),
      ])

      if (
        adaptedCvPdfBytes === null ||
        adaptationSummaryBytes === null ||
        coverLetterPdfBytes === null ||
        coverLetterPlainTextBytes === null ||
        originalCv === null ||
        vacancy === null
      ) {
        return null
      }

      let adaptationSummary: AdaptationSummaryModel

      try {
        adaptationSummary = JSON.parse(
          adaptationSummaryBytes.toString('utf8'),
        ) as AdaptationSummaryModel
      } catch {
        return null
      }

      return {
        adaptedCv: {
          pageCount: metadata.adaptedCvPageCount ?? 1,
          pageWarning: metadata.adaptedCvPageWarning,
          pdfBytes: new Uint8Array(adaptedCvPdfBytes),
        },
        adaptationSummary,
        coverLetter: {
          pageCount: metadata.coverLetterPageCount ?? 1,
          pageWarning: metadata.coverLetterPageWarning,
          pdfBytes: new Uint8Array(coverLetterPdfBytes),
          plainText: coverLetterPlainTextBytes.toString('utf8'),
        },
        createdAt: metadata.createdAt,
        employer: metadata.employer,
        id: tailoredApplicationId,
        originalCv,
        title: createTailoredApplicationTitle(metadata),
        vacancy,
        vacancyTitle: metadata.vacancyTitle,
      }
    },
    getWorkspaceState,
    recoverInterruptedGeneration: async () => {
      const pendingSession = await getPendingGenerationSession()

      if (pendingSession?.stage !== 'running') {
        return
      }

      if (pendingSession.tailoredApplicationId !== null) {
        await localAppData.deleteScopedData({
          id: pendingSession.tailoredApplicationId,
          scope: TAILORED_APPLICATION_SCOPE,
        })
      }

      if (pendingSession.generationRunId !== null) {
        await removeRunWorkspace(pendingSession.generationRunId)
      }

      await resetPendingGenerationState()
    },
    resumePendingGeneration: async () => {
      if (activeRunPromise !== null) {
        return await activeRunPromise
      }

      const command = await readinessStore.getPendingGenerationCommand()

      if (command === null) {
        throw new Error('There is no pending tailored-application generation to resume.')
      }

      activeAbortController = new AbortController()
      activeRunPromise = runPendingGeneration(command).finally(() => {
        activeAbortController = null
        activeRunPromise = null
      })

      return await activeRunPromise
    },
    startPendingGeneration: async ({ originalCvId, originalCvLabel, vacancyDraft }) => {
      if (activeRunPromise !== null) {
        throw new Error('A tailored application is already being generated.')
      }

      const originalCvTextBuffer = await localAppData.artifacts.read({
        id: originalCvId,
        name: 'extracted.txt',
        scope: ORIGINAL_CV_SCOPE,
      })

      if (originalCvTextBuffer === null) {
        throw new Error('The selected original CV is incomplete or unavailable.')
      }

      if (
        assessEnglishLanguageSupport(originalCvTextBuffer.toString('utf8')).status === 'blocked'
      ) {
        throw new Error(ORIGINAL_CV_LANGUAGE_BLOCK_MESSAGE)
      }

      const vacancyWorkspace = await localAppData.metadata.get<VacancyWorkspaceMetadataValue>({
        id: VACANCY_WORKSPACE_ENTRY_ID,
        scope: VACANCY_WORKSPACE_SCOPE,
      })
      const vacancyMetadata =
        vacancyWorkspace?.vacancyId === null || vacancyWorkspace?.vacancyId === undefined
          ? null
          : await localAppData.metadata.get<VacancyMetadataValue>({
              id: vacancyWorkspace.vacancyId,
              scope: VACANCY_SCOPE,
            })

      if (
        vacancyWorkspace?.vacancyId === null ||
        vacancyWorkspace?.vacancyId === undefined ||
        resolveVacancyWorkspaceReviewState({
          vacancyMetadata,
          vacancyWorkspace,
        }) !== 'reviewed' ||
        vacancyWorkspace.text !== vacancyDraft.text ||
        vacancyWorkspace.url !== vacancyDraft.url
      ) {
        throw new Error('Review a complete job before tailoring your CV.')
      }

      const vacancyTextBuffer = await localAppData.artifacts.read({
        id: vacancyWorkspace.vacancyId,
        name: 'extracted.txt',
        scope: VACANCY_SCOPE,
      })

      if (vacancyMetadata?.canGenerate !== true || vacancyMetadata.status !== 'ready') {
        throw new Error('Review a complete job before tailoring your CV.')
      }

      if (vacancyTextBuffer === null) {
        throw new Error('The selected vacancy preview is incomplete or unavailable.')
      }

      if (assessEnglishLanguageSupport(vacancyTextBuffer.toString('utf8')).status === 'blocked') {
        throw new Error(VACANCY_LANGUAGE_BLOCK_MESSAGE)
      }

      await readinessStore.savePendingGenerationCommand({
        commandId: generateId(),
        originalCvId,
        originalCvLabel,
        vacancyDraft: {
          text: vacancyDraft.text,
          url: vacancyDraft.url,
        },
        vacancyId: vacancyWorkspace.vacancyId,
      })
      await savePendingGenerationSession({
        commandId: await getPendingCommandId(readinessStore),
        generationRunId: null,
        stage: 'queued',
        tailoredApplicationId: null,
      })
      await readinessStore.setStartupDestination('workspace')

      return await aiWorker.retryAiWorkerPreflight()
    },
    setWorkspaceSelection: async (selection) => {
      await workspaceSelectionStore?.setSelection(selection)
    },
  }
}

async function hasMeaningfulVacancyDraft(
  localAppData: Pick<LocalAppDataStore, 'metadata'>,
): Promise<boolean> {
  const draftRecord = await localAppData.metadata.get<VacancyWorkspaceMetadataValue>({
    id: VACANCY_WORKSPACE_ENTRY_ID,
    scope: VACANCY_WORKSPACE_SCOPE,
  })

  if (draftRecord === null) {
    return false
  }

  return (
    draftRecord.text.trim() !== '' ||
    draftRecord.url.trim() !== '' ||
    draftRecord.vacancyId !== null
  )
}

function resolveVacancyWorkspaceReviewState({
  vacancyMetadata,
  vacancyWorkspace,
}: {
  vacancyMetadata: VacancyMetadataValue | null
  vacancyWorkspace: VacancyWorkspaceMetadataValue
}): 'editable' | 'reviewed' {
  if (vacancyMetadata === null) {
    return 'editable'
  }

  if (vacancyWorkspace.reviewState === 'reviewed') {
    return 'reviewed'
  }

  if (vacancyWorkspace.reviewState === 'editable') {
    return 'editable'
  }

  if (vacancyMetadata.canGenerate && vacancyMetadata.status === 'ready') {
    return 'reviewed'
  }

  return 'editable'
}

function resolveNextWorkspaceSelection({
  applications,
  hasMeaningfulDraft,
}: {
  applications: TailoredApplicationWorkspaceState['applications']
  hasMeaningfulDraft: boolean
}): WorkspaceSelection {
  if (hasMeaningfulDraft) {
    return {
      kind: 'draft',
    }
  }

  const newestApplication = applications[0]

  if (newestApplication !== undefined) {
    return {
      kind: 'tailored_application',
      tailoredApplicationId: newestApplication.id,
    }
  }

  return {
    kind: 'none',
  }
}

function resolveSelectedTailoredApplicationId({
  applications,
  hasMeaningfulDraft,
  selection,
}: {
  applications: TailoredApplicationWorkspaceState['applications']
  hasMeaningfulDraft: boolean
  selection: WorkspaceSelection | null
}): string | null {
  if (hasMeaningfulDraft) {
    return null
  }

  if (selection?.kind === 'none') {
    return null
  }

  if (selection?.kind === 'tailored_application') {
    const selectedApplication = applications.find((application) => {
      return application.id === selection.tailoredApplicationId
    })

    if (selectedApplication !== undefined) {
      return selectedApplication.id
    }
  }

  return applications[0]?.id ?? null
}

function buildAdaptedCvModel({
  generatedAdaptedCv,
  originalCv,
}: {
  generatedAdaptedCv: GeneratedAdaptedCvModel
  originalCv: NormalizedOriginalCv
}): AdaptedCvModel {
  return {
    ...generatedAdaptedCv,
    header: {
      contact: toAdaptedCvHeaderContact(originalCv.contact),
      intro: generatedAdaptedCv.header.intro,
    },
  }
}

function parseNormalizedOriginalCvJson(normalizedJson: string): NormalizedOriginalCv {
  let parsedValue: unknown

  try {
    parsedValue = JSON.parse(normalizedJson) as unknown
  } catch {
    throw new Error('The selected original CV is incomplete or unavailable.')
  }

  if (!isNormalizedOriginalCv(parsedValue)) {
    throw new Error('The selected original CV is incomplete or unavailable.')
  }

  return parsedValue
}

function isNormalizedOriginalCv(value: unknown): value is NormalizedOriginalCv {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>
  const contact = candidate.contact

  if (contact === null || typeof contact !== 'object' || Array.isArray(contact)) {
    return false
  }

  const normalizedContact = contact as Record<string, unknown>

  return (
    typeof candidate.fullName === 'string' &&
    typeof candidate.headline === 'string' &&
    typeof candidate.summary === 'string' &&
    Array.isArray(candidate.experience) &&
    candidate.experience.every((entry) => {
      return isNormalizedOriginalCvExperienceEntry(entry)
    }) &&
    Array.isArray(candidate.skills) &&
    candidate.skills.every((entry) => {
      return typeof entry === 'string'
    }) &&
    typeof normalizedContact.email === 'string' &&
    typeof normalizedContact.location === 'string' &&
    typeof normalizedContact.phone === 'string' &&
    typeof normalizedContact.professionalLink === 'string'
  )
}

function isNormalizedOriginalCvExperienceEntry(
  value: unknown,
): value is NormalizedOriginalCv['experience'][number] {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).dateRange === 'string' &&
    typeof (value as Record<string, unknown>).employer === 'string' &&
    typeof (value as Record<string, unknown>).roleTitle === 'string' &&
    typeof (value as Record<string, unknown>).summary === 'string'
  )
}

function toAdaptedCvHeaderContact(contact: NormalizedOriginalCv['contact']) {
  return {
    email: normalizeOptionalContactValue(contact.email),
    location: normalizeOptionalContactValue(contact.location),
    phone: normalizeOptionalContactValue(contact.phone),
    professionalLink: normalizeOptionalContactValue(contact.professionalLink),
  }
}

function normalizeOptionalContactValue(value: string): string | null {
  const trimmedValue = value.trim()

  if (trimmedValue === '') {
    return null
  }

  return trimmedValue
}

async function getPendingCommandId(
  readinessStore: Pick<AiWorkerReadinessStore, 'getPendingGenerationCommand'>,
): Promise<string> {
  const pendingGenerationCommand = await readinessStore.getPendingGenerationCommand()

  if (pendingGenerationCommand === null) {
    throw new Error('Failed to persist the pending generation command.')
  }

  return pendingGenerationCommand.commandId
}

function validateTailoredApplicationGenerationResult(
  result: unknown,
  context: {
    originalCvHeadline: string
    originalCvExperience: NormalizedOriginalCv['experience']
    vacancyTitle: string | null
  },
): asserts result is TailoredApplicationGenerationResult {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throwContractValidationError({
      code: 'tailored_application_result_invalid',
      detail: 'Expected an object.',
      path: 'result',
    })
  }

  const candidate = result as Record<string, unknown>

  if (!isGeneratedAdaptedCvModel(candidate.adaptedCv, context)) {
    throwContractValidationError({
      code: 'adapted_cv_invalid',
      detail: describeGeneratedAdaptedCvValidationFailure(candidate.adaptedCv, context),
      path: 'adaptedCv',
    })
  }

  if (!isCoverLetterModel(candidate.coverLetter)) {
    throwContractValidationError({
      code: 'cover_letter_invalid',
      detail: 'Expected a valid coverLetter object.',
      path: 'coverLetter',
    })
  }

  if (!isAdaptationSummaryModel(candidate.adaptationSummary)) {
    throwContractValidationError({
      code: 'adaptation_summary_invalid',
      detail: 'Expected a valid adaptationSummary object.',
      path: 'adaptationSummary',
    })
  }

  if (!isTraceMetadata(candidate.trace)) {
    throwContractValidationError({
      code: 'tailored_application_result_invalid',
      detail: 'Expected a valid trace object.',
      path: 'trace',
    })
  }

  const missingSourceExperienceEntries = getMissingSourceExperienceEntries(
    candidate.adaptedCv.sections,
    context.originalCvExperience,
  )

  if (missingSourceExperienceEntries.length > 0) {
    throwContractValidationError({
      code: 'adapted_cv_invalid',
      detail: `Expected adaptedCv.sections experience items to retain every source role from originalCv.experience. Missing: ${missingSourceExperienceEntries.join(
        ', ',
      )}.`,
      path: 'adaptedCv',
    })
  }
}

function normalizeTailoredApplicationGenerationResult(
  result: TailoredApplicationGenerationResult,
  context: {
    originalCvHeadline: string
    vacancyTitle: string | null
  },
): TailoredApplicationGenerationResult {
  const normalizedAdaptedCv = normalizeGeneratedAdaptedCvModel(result.adaptedCv, context)

  if (normalizedAdaptedCv === result.adaptedCv) {
    return result
  }

  return {
    ...result,
    adaptedCv: normalizedAdaptedCv,
  }
}

function normalizeGeneratedAdaptedCvModel(
  adaptedCv: TailoredApplicationGenerationResult['adaptedCv'],
  context: {
    originalCvHeadline: string
    vacancyTitle: string | null
  },
): TailoredApplicationGenerationResult['adaptedCv'] {
  const canonicalHeadline = resolveCanonicalAdaptedCvHeadline(
    adaptedCv.headline.text,
    adaptedCv.sections,
    context,
  )

  if (canonicalHeadline === null || canonicalHeadline === adaptedCv.headline.text) {
    return adaptedCv
  }

  return {
    ...adaptedCv,
    headline: {
      ...adaptedCv.headline,
      text: canonicalHeadline,
    },
  }
}

function isGeneratedAdaptedCvModel(
  value: unknown,
  context: {
    originalCvHeadline: string
    vacancyTitle: string | null
  },
): value is GeneratedAdaptedCvModel {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.candidateName === 'string' &&
    isGeneratedAdaptedCvHeader(candidate.header) &&
    isGroundedText(candidate.headline) &&
    Array.isArray(candidate.sections) &&
    candidate.sections.every((section) => {
      return isGeneratedAdaptedCvSection(section)
    }) &&
    resolveCanonicalAdaptedCvHeadline(candidate.headline.text, candidate.sections, context) !==
      null &&
    hasRequiredAdaptedCvSections(candidate.sections) &&
    getDuplicatedCoreSkillsAndToolsLabels(candidate.sections).length === 0 &&
    isGeneratedAdaptedCvHeaderIntroFit(candidate as unknown as GeneratedAdaptedCvModel) &&
    isGeneratedAdaptedCvProfileFit(candidate as unknown as GeneratedAdaptedCvModel)
  )
}

function describeGeneratedAdaptedCvValidationFailure(
  value: unknown,
  context: {
    originalCvHeadline: string
    vacancyTitle: string | null
  },
): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'Expected adaptedCv to be an object.'
  }

  const candidate = value as Record<string, unknown>

  if (typeof candidate.candidateName !== 'string') {
    return 'Expected adaptedCv.candidateName to be a string.'
  }

  if (!isGeneratedAdaptedCvHeader(candidate.header)) {
    return 'Expected adaptedCv.header.intro.text to be a string.'
  }

  if (!isGroundedText(candidate.headline)) {
    return 'Expected adaptedCv.headline.text to be a string.'
  }

  if (!Array.isArray(candidate.sections)) {
    return 'Expected adaptedCv.sections to be an array.'
  }

  const sections = candidate.sections as unknown[]

  const invalidSectionIndex = sections.findIndex((section) => {
    return !isGeneratedAdaptedCvSection(section)
  })

  if (invalidSectionIndex !== -1) {
    const invalidSection = sections[invalidSectionIndex]

    return (
      describeGeneratedAdaptedCvSectionValidationFailure(invalidSectionIndex, invalidSection) ??
      `Expected adaptedCv.sections[${String(invalidSectionIndex)}] to match the section contract.`
    )
  }

  if (
    resolveCanonicalAdaptedCvHeadline(candidate.headline.text, candidate.sections, context) === null
  ) {
    return 'Expected adaptedCv.headline.text to resolve to a canonical role label from the original CV, vacancy title, or structured experience role titles.'
  }

  const missingRequiredSectionKinds = getMissingRequiredAdaptedCvSectionKinds(sections)
  const returnedSectionKinds = getAdaptedCvSectionKinds(sections)

  if (missingRequiredSectionKinds.length > 0) {
    return `Expected adaptedCv.sections to include ${missingRequiredSectionKinds.join(
      ', ',
    )}. Received sections: ${returnedSectionKinds.join(', ') || 'none'}.`
  }

  const duplicatedSidebarLabels = getDuplicatedCoreSkillsAndToolsLabels(sections)

  if (duplicatedSidebarLabels.length > 0) {
    return `Expected adaptedCv tools items to avoid duplicating core_skills entries. Overlap: ${duplicatedSidebarLabels.join(', ')}.`
  }

  if (!isGeneratedAdaptedCvHeaderIntroFit(candidate as unknown as GeneratedAdaptedCvModel)) {
    return `Expected adaptedCv.header.intro.text to be at most ${String(MAX_HEADER_INTRO_LENGTH)} characters.`
  }

  if (!isGeneratedAdaptedCvProfileFit(candidate as unknown as GeneratedAdaptedCvModel)) {
    return `Expected adaptedCv profile summary to be at most ${String(MAX_PROFILE_SUMMARY_LENGTH)} characters.`
  }

  return 'Expected a valid adaptedCv object.'
}

function isGeneratedAdaptedCvHeader(value: unknown): value is GeneratedAdaptedCvModel['header'] {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isGroundedText((value as Record<string, unknown>).intro)
  )
}

function isGeneratedAdaptedCvSection(
  value: unknown,
): value is GeneratedAdaptedCvModel['sections'][number] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  if (candidate.kind === 'profile') {
    return isNonEmptyGroundedText(candidate.summary)
  }

  if (candidate.kind === 'experience') {
    return (
      Array.isArray(candidate.items) &&
      candidate.items.length > 0 &&
      candidate.items.every((experienceHighlight) => {
        return isAdaptedCvExperienceEntry(experienceHighlight)
      })
    )
  }

  if (candidate.kind === 'core_skills') {
    return isRequiredAdaptedCvSkillList(candidate.items, 6)
  }

  if (candidate.kind === 'selected_work' || candidate.kind === 'impact_highlights') {
    return isNarrativeEvidenceTextList(candidate.items)
  }

  if (candidate.kind === 'tools') {
    return isUngroupedToolListWithinCap(candidate.items, 6)
  }

  if (candidate.kind === 'education') {
    return isAdaptedCvEducationEntry(candidate.entry)
  }

  if (candidate.kind === 'certifications') {
    return isConciseGroundedTextListWithinCap(candidate.items, 2)
  }

  if (candidate.kind === 'languages' || candidate.kind === 'focus') {
    return isConciseGroundedTextListWithinCap(candidate.items, 3)
  }

  return candidate.kind === 'references'
}

function hasRequiredAdaptedCvSections(sections: unknown[]): boolean {
  return getMissingRequiredAdaptedCvSectionKinds(sections).length === 0
}

function getMissingRequiredAdaptedCvSectionKinds(sections: unknown[]): string[] {
  const kinds = getAdaptedCvSectionKinds(sections)

  return ['profile', 'experience', 'core_skills', 'references'].filter((kind) => {
    return !kinds.includes(kind)
  })
}

function getAdaptedCvSectionKinds(sections: unknown[]): string[] {
  const kinds = new Set(
    sections.flatMap((section) => {
      if (section === null || typeof section !== 'object' || Array.isArray(section)) {
        return []
      }

      const kind = (section as Record<string, unknown>).kind

      return typeof kind === 'string' ? [kind] : []
    }),
  )

  return [...kinds]
}

function getDuplicatedCoreSkillsAndToolsLabels(sections: unknown[]): string[] {
  const coreSkillsSection = sections.find((section) => {
    return (
      section !== null &&
      typeof section === 'object' &&
      !Array.isArray(section) &&
      (section as Record<string, unknown>).kind === 'core_skills'
    )
  }) as
    | {
        items?: unknown
      }
    | undefined

  const toolsSection = sections.find((section) => {
    return (
      section !== null &&
      typeof section === 'object' &&
      !Array.isArray(section) &&
      (section as Record<string, unknown>).kind === 'tools'
    )
  }) as
    | {
        items?: unknown
      }
    | undefined

  if (!Array.isArray(coreSkillsSection?.items) || !Array.isArray(toolsSection?.items)) {
    return []
  }

  const coreSkillLabels = new Map(
    coreSkillsSection.items.flatMap((item) => {
      if (!isNonEmptyGroundedText(item)) {
        return []
      }

      return [[normalizeSidebarLabel(item.text), item.text] as const]
    }),
  )

  return toolsSection.items.flatMap((item) => {
    if (!isNonEmptyGroundedText(item)) {
      return []
    }

    const normalizedLabel = normalizeSidebarLabel(item.text)
    const duplicatedLabel = coreSkillLabels.get(normalizedLabel)

    return duplicatedLabel === undefined ? [] : [duplicatedLabel]
  })
}

function isAdaptedCvExperienceEntry(value: unknown): value is AdaptedCvExperienceEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.dateRange === 'string' &&
    candidate.dateRange.trim() !== '' &&
    typeof candidate.employer === 'string' &&
    candidate.employer.trim() !== '' &&
    (candidate.location === null || typeof candidate.location === 'string') &&
    typeof candidate.roleTitle === 'string' &&
    candidate.roleTitle.trim() !== '' &&
    Array.isArray(candidate.bullets) &&
    candidate.bullets.length > 0 &&
    candidate.bullets.every((bullet) => {
      return isNonEmptyGroundedText(bullet)
    })
  )
}

function isAdaptedCvSkill(value: unknown): value is AdaptedCvSkill {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).text === 'string' &&
    isConciseSidebarLabel((value as Record<string, unknown>).text as string)
  )
}

function isRequiredAdaptedCvSkillList(value: unknown, maximumItems: number): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximumItems &&
    value.every((item) => {
      return isAdaptedCvSkill(item)
    })
  )
}

function isConciseGroundedTextListWithinCap(
  value: unknown,
  maximumItems: number,
  labelConstraints?: {
    maximumLength?: number
    maximumWords?: number
  },
): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((item) => {
      return isNonEmptyGroundedText(item) && isConciseSidebarLabel(item.text, labelConstraints)
    })
  )
}

function isUngroupedToolListWithinCap(value: unknown, maximumItems: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((item) => {
      return isNonEmptyGroundedText(item) && isUngroupedToolLabel(item.text)
    })
  )
}

function isNarrativeEvidenceTextList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => {
      return isNonEmptyGroundedText(item)
    }) &&
    value.some((item) => {
      return !isConciseSidebarLabel(item.text, {
        maximumLength: 40,
        maximumWords: 2,
      })
    })
  )
}

function isConciseSidebarLabel(
  value: string,
  {
    maximumLength = 48,
    maximumWords = 4,
  }: {
    maximumLength?: number
    maximumWords?: number
  } = {},
): boolean {
  const normalizedValue = value.trim()

  if (
    normalizedValue === '' ||
    normalizedValue.length > maximumLength ||
    /[.!?]$/u.test(normalizedValue)
  ) {
    return false
  }

  return countWords(normalizedValue) <= maximumWords
}

function countWords(value: string): number {
  const matches = value.match(/[A-Za-z0-9+#./&'-]+/gu)

  return matches?.length ?? 0
}

function normalizeSidebarLabel(value: string): string {
  return value.trim().toLowerCase()
}

function isUngroupedToolLabel(value: string): boolean {
  return (
    isConciseSidebarLabel(value) &&
    !/[()]/u.test(value) &&
    !/,\s/u.test(value) &&
    !/;\s/u.test(value) &&
    !/\s+and\s+/iu.test(value) &&
    !/\s+\+\s+/u.test(value) &&
    !/\s+\/\s+/u.test(value) &&
    !/\s*&\s*/u.test(value)
  )
}

function describeGeneratedAdaptedCvSectionValidationFailure(
  sectionIndex: number,
  value: unknown,
): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (candidate.kind === 'core_skills') {
    return `Expected adaptedCv.sections[${String(sectionIndex)}] core_skills items to be concise sidebar labels rather than sentence-like content.`
  }

  if (candidate.kind === 'selected_work' || candidate.kind === 'impact_highlights') {
    return `Expected adaptedCv.sections[${String(sectionIndex)}] ${candidate.kind} items to contain grounded evidence lines rather than bare skill or tool labels.`
  }

  if (
    candidate.kind === 'tools' ||
    candidate.kind === 'certifications' ||
    candidate.kind === 'languages' ||
    candidate.kind === 'focus'
  ) {
    if (candidate.kind === 'tools') {
      return `Expected adaptedCv.sections[${String(sectionIndex)}] tools items to be concise ungrouped sidebar labels.`
    }

    return `Expected adaptedCv.sections[${String(sectionIndex)}] ${candidate.kind} items to be concise sidebar labels.`
  }

  return null
}

function isAdaptedCvEducationEntry(
  value: unknown,
): value is Extract<GeneratedAdaptedCvModel['sections'][number], { kind: 'education' }>['entry'] {
  if (value === null) {
    return true
  }

  return (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).meta === 'string' &&
    ((value as Record<string, unknown>).meta as string).trim() !== '' &&
    typeof (value as Record<string, unknown>).title === 'string' &&
    ((value as Record<string, unknown>).title as string).trim() !== ''
  )
}

function isGeneratedAdaptedCvHeaderIntroFit(value: GeneratedAdaptedCvModel): boolean {
  return value.header.intro.text.length <= MAX_HEADER_INTRO_LENGTH
}

function isGeneratedAdaptedCvProfileFit(value: GeneratedAdaptedCvModel): boolean {
  const profileSection = value.sections.find((section) => {
    return section.kind === 'profile'
  })

  if (profileSection?.kind !== 'profile') {
    return false
  }

  return profileSection.summary.text.length <= MAX_PROFILE_SUMMARY_LENGTH
}

function resolveCanonicalAdaptedCvHeadline(
  headline: string,
  sections: unknown[],
  context: {
    originalCvHeadline: string
    vacancyTitle: string | null
  },
): string | null {
  const normalizedHeadline = normalizeRoleLabel(headline)

  if (normalizedHeadline === null) {
    return null
  }

  const canonicalRoleLabels = buildCanonicalRoleLabels(sections, context)
  const matchingRoleLabel = canonicalRoleLabels.find((roleLabel) => {
    return roleLabel.normalized === normalizedHeadline
  })

  return matchingRoleLabel?.display ?? null
}

function extractExperienceRoleTitles(sections: unknown[]): string[] {
  return sections.flatMap((section) => {
    if (
      section === null ||
      typeof section !== 'object' ||
      Array.isArray(section) ||
      (section as Record<string, unknown>).kind !== 'experience'
    ) {
      return []
    }

    const items = (section as Record<string, unknown>).items

    if (!Array.isArray(items)) {
      return []
    }

    return items.flatMap((item) => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        return []
      }

      const roleTitle = (item as Record<string, unknown>).roleTitle

      return typeof roleTitle === 'string' ? [roleTitle] : []
    })
  })
}

function buildCanonicalRoleLabels(
  sections: unknown[],
  context: {
    originalCvHeadline: string
    vacancyTitle: string | null
  },
): {
  display: string
  normalized: string
}[] {
  return [
    context.originalCvHeadline,
    context.vacancyTitle,
    ...extractExperienceRoleTitles(sections),
  ].flatMap((value) => {
    const roleLabel = toCanonicalRoleLabel(value)

    return roleLabel === null ? [] : [roleLabel]
  })
}

function toCanonicalRoleLabel(value: string | null): {
  display: string
  normalized: string
} | null {
  const roleLabel = extractRoleLabel(value)

  if (roleLabel === null) {
    return null
  }

  return {
    display: roleLabel,
    normalized: roleLabel.toLocaleLowerCase('en-GB'),
  }
}

function normalizeRoleLabel(value: string | null): string | null {
  const roleLabel = extractRoleLabel(value)

  return roleLabel === null ? null : roleLabel.toLocaleLowerCase('en-GB')
}

function getMissingSourceExperienceEntries(
  sections: unknown[],
  sourceExperienceEntries: NormalizedOriginalCv['experience'],
): string[] {
  const sourceIdentities = sourceExperienceEntries.flatMap((entry) => {
    const identity = createSourceExperienceIdentity(entry)

    return identity === null ? [] : [identity]
  })

  if (sourceIdentities.length === 0) {
    return []
  }

  const generatedExperienceKeys = new Set(
    extractGeneratedExperienceEntries(sections).map((entry) => {
      return createExperienceIdentityKey({
        dateRange: entry.dateRange,
        employer: entry.employer,
        roleTitle: entry.roleTitle,
      })
    }),
  )

  return sourceIdentities.flatMap((identity) => {
    return generatedExperienceKeys.has(identity.key) ? [] : [identity.display]
  })
}

function extractGeneratedExperienceEntries(sections: unknown[]): AdaptedCvExperienceEntry[] {
  return sections.flatMap((section) => {
    if (
      section === null ||
      typeof section !== 'object' ||
      Array.isArray(section) ||
      (section as Record<string, unknown>).kind !== 'experience'
    ) {
      return []
    }

    const items = (section as Record<string, unknown>).items

    if (!Array.isArray(items)) {
      return []
    }

    return items.flatMap((item) => {
      return isAdaptedCvExperienceEntry(item) ? [item] : []
    })
  })
}

function createSourceExperienceIdentity(entry: NormalizedOriginalCv['experience'][number]): {
  display: string
  key: string
} | null {
  const roleTitle = entry.roleTitle.trim()
  const employer = entry.employer.trim()
  const dateRange = entry.dateRange.trim()

  if (roleTitle === '' || employer === '' || dateRange === '') {
    return null
  }

  return {
    display: [roleTitle, employer, dateRange].join(' | '),
    key: createExperienceIdentityKey({
      dateRange,
      employer,
      roleTitle,
    }),
  }
}

function createExperienceIdentityKey({
  dateRange,
  employer,
  roleTitle,
}: {
  dateRange: string
  employer: string
  roleTitle: string
}): string {
  return [roleTitle, employer, dateRange]
    .map((value) => {
      return normalizeExperienceIdentityPart(value)
    })
    .join('::')
}

function normalizeExperienceIdentityPart(value: string): string {
  return value
    .replaceAll(/[‐‑‒–—−]/gu, '-')
    .replaceAll(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-GB')
}

function extractRoleLabel(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const collapsedWhitespace = value.replaceAll(/\s+/gu, ' ').trim()

  if (collapsedWhitespace === '') {
    return null
  }

  const withoutParentheticalSuffix = collapsedWhitespace.replace(/\s+\([^)]*\)$/u, '').trim()
  const normalizedValue =
    withoutParentheticalSuffix === '' ? collapsedWhitespace : withoutParentheticalSuffix
  const suffixSeparatorMatch = /\s(?:\/|\||·|:|—|–|-)\s/u.exec(normalizedValue)
  const roleOnlyLabel =
    suffixSeparatorMatch?.index === undefined
      ? normalizedValue
      : normalizedValue.slice(0, suffixSeparatorMatch.index).trim()

  if (roleOnlyLabel === '') {
    return null
  }

  return roleOnlyLabel
}

function isNonEmptyGroundedText(value: unknown): value is GroundedText {
  return isGroundedText(value) && value.text.trim() !== ''
}

function isGroundedText(value: unknown): value is GroundedText {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).text === 'string'
  )
}

function isCoverLetterModel(value: unknown): value is CoverLetterModel {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    Array.isArray(candidate.body) &&
    candidate.body.every((paragraph) => {
      return isGroundedText(paragraph)
    }) &&
    isGroundedText(candidate.closing) &&
    typeof candidate.date === 'string' &&
    typeof candidate.greeting === 'string' &&
    isGroundedText(candidate.opening) &&
    typeof candidate.signature === 'string'
  )
}

function buildCoverLetterPlainText(coverLetter: CoverLetterModel): string {
  return [
    coverLetter.date,
    '',
    coverLetter.greeting,
    '',
    coverLetter.opening.text,
    '',
    ...coverLetter.body.flatMap((paragraph) => {
      return [paragraph.text, '']
    }),
    coverLetter.closing.text,
    '',
    coverLetter.signature,
  ].join('\n')
}

function boundTailoredApplicationSourceText(value: string): string {
  if (value.length <= MAX_TAILORED_APPLICATION_SOURCE_TEXT_LENGTH) {
    return value
  }

  return value.slice(0, MAX_TAILORED_APPLICATION_SOURCE_TEXT_LENGTH).trimEnd()
}

function isAdaptationSummaryModel(value: unknown): value is AdaptationSummaryModel {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    Array.isArray(candidate.emphasized) &&
    candidate.emphasized.every((item) => {
      return isGroundedText(item)
    }) &&
    Array.isArray(candidate.gaps) &&
    candidate.gaps.every((item) => {
      return typeof item === 'string'
    }) &&
    Array.isArray(candidate.omitted) &&
    candidate.omitted.every((item) => {
      return isGroundedText(item)
    }) &&
    Array.isArray(candidate.validationHints) &&
    candidate.validationHints.every((item) => {
      return typeof item === 'string'
    })
  )
}

function isTraceMetadata(value: unknown): value is TailoredApplicationGenerationResult['trace'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    (candidate.model === null || typeof candidate.model === 'string') &&
    candidate.provider === 'codex' &&
    (candidate.sessionId === null || typeof candidate.sessionId === 'string')
  )
}

function throwContractValidationError({
  code,
  detail,
  path,
}: {
  code: TailoredApplicationContractErrorCode
  detail?: string
  path: string
}): never {
  throw new TailoredApplicationContractValidationError({
    code,
    detail,
    path,
  })
}

function isPendingGenerationSessionRecord(value: unknown): value is PendingGenerationSessionRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.commandId === 'string' &&
    (candidate.generationRunId === null || typeof candidate.generationRunId === 'string') &&
    (candidate.tailoredApplicationId === null ||
      typeof candidate.tailoredApplicationId === 'string') &&
    (candidate.stage === 'queued' || candidate.stage === 'ready' || candidate.stage === 'running')
  )
}
