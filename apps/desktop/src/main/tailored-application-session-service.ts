import { randomUUID } from 'node:crypto'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type {
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
import type { VacancyDraft, VacancySummary } from '../shared/vacancy.js'
import {
  ORIGINAL_CV_LANGUAGE_BLOCK_MESSAGE,
  VACANCY_LANGUAGE_BLOCK_MESSAGE,
  assessEnglishLanguageSupport,
} from '../shared/language-support.js'
import type { AiWorkerPreflightService } from './ai-worker-preflight-service.js'
import type { AiWorkerReadinessStore } from './ai-worker-readiness-store.js'
import { buildAdaptedCvExportFilename, resolveUniqueExportFilePath } from './adapted-cv-document.js'
import { extractAdaptedCvHeaderContact } from './adapted-cv-contact-details.js'
import { buildCoverLetterExportFilename } from './cover-letter-document.js'
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js'
import {
  parseWritingStyleProfileJson,
  type WritingStyleProfile,
} from './tailored-application-style-validator.js'

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
  'Generated tailored application failed contract validation.'
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
  completePendingGeneration: (commandId: string) => Promise<void>
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
  startPendingGeneration: (input: StartPendingGenerationInput) => Promise<AiWorkerPreflightResult>
}

export interface AdaptedCvRenderer {
  renderAdaptedCvPdf: (input: {
    adaptedCv: AdaptedCvModel
    employer: string | null
    vacancyTitle: string | null
  }) => Promise<{
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
  text: string
  url: string
  vacancyId: string | null
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
}

interface OriginalCvContext {
  headline: string
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
  const titleParts = [vacancyTitle, employer].filter((value): value is string => {
    return value !== null && value.trim() !== ''
  })

  if (titleParts.length === 0) {
    return 'Tailored application'
  }

  return titleParts.join(' · ')
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
}: CreateTailoredApplicationSessionServiceOptions): TailoredApplicationSessionService {
  let activeAbortController: AbortController | null = null
  let activeRunPromise: Promise<ResumePendingGenerationResult> | null = null

  async function resetPendingGenerationState(): Promise<void> {
    await clearPendingGenerationSession()
    await readinessStore.clearPendingGenerationCommand()
    await readinessStore.setStartupDestination('workspace_empty')
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

    return {
      headline: originalCvMetadata.headline,
      normalizedJson: normalizedJsonBuffer.toString('utf8'),
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
      normalizedJsonBuffer === null ||
      vacancyTextBuffer === null
    ) {
      throw new Error('The selected vacancy preview is incomplete or unavailable.')
    }

    if (!vacancyMetadata.canGenerate || vacancyMetadata.status !== 'ready') {
      throw new Error('Review a complete job vacancy before adapting this CV.')
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

    try {
      const rawResult = await worker.runGeneration({
        runDirectoryPath,
        signal: activeAbortController?.signal ?? new AbortController().signal,
      })
      const result = normalizeTailoredApplicationGenerationResult(rawResult, {
        originalCvHeadline: originalCv.headline,
        vacancyTitle: vacancy.title,
      })

      validateTailoredApplicationGenerationResult(result, {
        originalCvHeadline: originalCv.headline,
        vacancyTitle: vacancy.title,
      })
      const renderReadyAdaptedCv = buildAdaptedCvModel({
        generatedAdaptedCv: result.adaptedCv,
        originalCvText: originalCv.originalCvText,
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
      await persistReadyArtifacts({
        adaptedCvPageCount: renderedAdaptedCv.pageCount,
        adaptedCvPageWarning: renderedAdaptedCv.pageWarning,
        adaptedCvPdfBytes: renderedAdaptedCv.pdfBytes,
        coverLetterPageCount: renderedCoverLetter.pageCount,
        coverLetterPageWarning: renderedCoverLetter.pageWarning,
        coverLetterPdfBytes: renderedCoverLetter.pdfBytes,
        employer: vacancy.employer,
        originalCvId: command.originalCvId,
        adaptedCv: renderReadyAdaptedCv,
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
        throw error
      }

      if (
        error instanceof Error &&
        error.message === 'Tailored application generation timed out.'
      ) {
        throw error
      }

      throw new Error('Tailored application generation failed.', {
        cause: error,
      })
    } finally {
      await removeRunWorkspace(generationRunId)
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
      await readinessStore.setStartupDestination('workspace_active')
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
    getWorkspaceState: async () => {
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

      return {
        activeApplicationId: readyApplications[0]?.id ?? null,
        applications: readyApplications,
      }
    },
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

      if (
        vacancyWorkspace?.vacancyId === null ||
        vacancyWorkspace?.vacancyId === undefined ||
        vacancyWorkspace.text !== vacancyDraft.text ||
        vacancyWorkspace.url !== vacancyDraft.url
      ) {
        throw new Error('Review a complete job vacancy before adapting this CV.')
      }

      const vacancyMetadata = await localAppData.metadata.get<VacancyMetadataValue>({
        id: vacancyWorkspace.vacancyId,
        scope: VACANCY_SCOPE,
      })

      const vacancyTextBuffer = await localAppData.artifacts.read({
        id: vacancyWorkspace.vacancyId,
        name: 'extracted.txt',
        scope: VACANCY_SCOPE,
      })

      if (vacancyMetadata?.canGenerate !== true || vacancyMetadata.status !== 'ready') {
        throw new Error('Review a complete job vacancy before adapting this CV.')
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
      await readinessStore.setStartupDestination('workspace_loading')

      return await aiWorker.retryAiWorkerPreflight()
    },
  }
}

function buildAdaptedCvModel({
  generatedAdaptedCv,
  originalCvText,
}: {
  generatedAdaptedCv: GeneratedAdaptedCvModel
  originalCvText: string
}): AdaptedCvModel {
  return {
    ...generatedAdaptedCv,
    header: {
      contact: extractAdaptedCvHeaderContact(originalCvText),
      intro: generatedAdaptedCv.header.intro,
    },
  }
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
      detail: 'Expected a valid adaptedCv object.',
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
    isGeneratedAdaptedCvTemplateFit(candidate as unknown as GeneratedAdaptedCvModel)
  )
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
    return isGroundedTextList(candidate.items)
  }

  if (candidate.kind === 'tools') {
    return isOptionalGroundedTextListWithinCap(candidate.items, 6)
  }

  if (candidate.kind === 'education') {
    return isAdaptedCvEducationEntry(candidate.entry)
  }

  if (candidate.kind === 'certifications') {
    return isOptionalGroundedTextListWithinCap(candidate.items, 2)
  }

  if (candidate.kind === 'languages' || candidate.kind === 'focus') {
    return isOptionalGroundedTextListWithinCap(candidate.items, 3)
  }

  return candidate.kind === 'references'
}

function hasRequiredAdaptedCvSections(sections: unknown[]): boolean {
  const kinds = new Set(
    sections.flatMap((section) => {
      if (section === null || typeof section !== 'object' || Array.isArray(section)) {
        return []
      }

      const kind = (section as Record<string, unknown>).kind

      return typeof kind === 'string' ? [kind] : []
    }),
  )

  return (
    kinds.has('profile') &&
    kinds.has('experience') &&
    kinds.has('core_skills') &&
    kinds.has('references')
  )
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
    ((value as Record<string, unknown>).text as string).trim() !== ''
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

function isGroundedTextList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      return isNonEmptyGroundedText(item)
    })
  )
}

function isOptionalGroundedTextListWithinCap(value: unknown, maximumItems: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maximumItems &&
    value.every((item) => {
      return isNonEmptyGroundedText(item)
    })
  )
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

function isGeneratedAdaptedCvTemplateFit(value: GeneratedAdaptedCvModel): boolean {
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

function extractRoleLabel(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const collapsedWhitespace = value.replaceAll(/\s+/gu, ' ').trim()

  if (collapsedWhitespace === '') {
    return null
  }

  const suffixSeparatorMatch = /\s(?:\||·|—|–|-)\s/u.exec(collapsedWhitespace)
  const roleOnlyLabel =
    suffixSeparatorMatch?.index === undefined
      ? collapsedWhitespace
      : collapsedWhitespace.slice(0, suffixSeparatorMatch.index).trim()

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
