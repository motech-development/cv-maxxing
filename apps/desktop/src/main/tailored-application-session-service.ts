import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AiWorkerPreflightResult } from '../shared/ai-worker-preflight.js'
import type {
  PendingGenerationCommand,
  ResumePendingGenerationResult,
  StartPendingGenerationInput,
} from '../shared/pending-generation.js'
import type { VacancyDraft } from '../shared/vacancy.js'
import type { AiWorkerPreflightService } from './ai-worker-preflight-service.js'
import type { AiWorkerReadinessStore } from './ai-worker-readiness-store.js'
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js'

const ORIGINAL_CV_SCOPE = 'original-cvs'
const VACANCY_SCOPE = 'vacancies'
const VACANCY_WORKSPACE_SCOPE = 'vacancy-workspace'
const VACANCY_WORKSPACE_ENTRY_ID = 'current'
const PENDING_GENERATION_SESSION_SCOPE = 'pending-generation-session'
const PENDING_GENERATION_SESSION_ENTRY_ID = 'active-session'
const TAILORED_APPLICATION_SCOPE = 'tailored-applications'
const GENERATION_RUN_SCOPE = 'generation-runs'

const BRITISH_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const
const AMERICAN_SPELLING_PATTERNS = [
  /\bcolor\b/iu,
  /\borganization\b/iu,
  /\boptimize\b/iu,
  /\bauthorize\b/iu,
  /\bcenter\b/iu,
  /\blicense\b/iu,
] as const
const ENGLISH_MARKERS = [
  'the',
  'and',
  'with',
  'for',
  'experience',
  'skills',
  'role',
  'summary',
  'responsibilities',
  'requirements',
  'design',
  'product',
] as const

export interface GroundedText {
  sourceEvidence: string[]
  text: string
}

export interface AdaptedCvExperienceHighlight {
  bullets: GroundedText[]
  heading: string
}

export interface AdaptedCvSkill {
  sourceEvidence: string[]
  text: string
}

export interface AdaptedCvModel {
  candidateName: string
  experienceHighlights: AdaptedCvExperienceHighlight[]
  headline: GroundedText
  skills: AdaptedCvSkill[]
  summary: GroundedText
}

export interface CoverLetterModel {
  body: GroundedText[]
  closing: GroundedText
  date: string
  greeting: string
  opening: GroundedText
  signature: string
}

export interface AdaptationSummaryModel {
  emphasized: GroundedText[]
  gaps: string[]
  omitted: GroundedText[]
  validationHints: string[]
}

export interface TailoredApplicationGenerationResult {
  adaptationSummary: AdaptationSummaryModel
  adaptedCv: AdaptedCvModel
  coverLetter: CoverLetterModel
  coverLetterPlainText: string
  trace: {
    model: string | null
    provider: 'codex'
    sessionId: string | null
  }
}

export interface TailoredApplicationGenerationWorker {
  runGeneration: (input: {
    runDirectoryPath: string
    signal: AbortSignal
  }) => Promise<TailoredApplicationGenerationResult>
}

export interface TailoredApplicationSessionService {
  abandonPendingGeneration: () => Promise<void>
  completePendingGeneration: (commandId: string) => Promise<void>
  getPendingGenerationCommand: () => Promise<PendingGenerationCommand | null>
  recoverInterruptedGeneration: () => Promise<void>
  resumePendingGeneration: () => Promise<ResumePendingGenerationResult>
  startPendingGeneration: (input: StartPendingGenerationInput) => Promise<AiWorkerPreflightResult>
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
  createdAt: string
  originalCvId: string
  status: 'generating' | 'ready'
  vacancyId: string
}

interface VacancyMetadataValue extends Record<string, JsonValue> {
  canGenerate: boolean
  employer: string | null
  status: 'incomplete' | 'ready'
  title: string | null
}

interface VacancyWorkspaceMetadataValue extends Record<string, JsonValue> {
  text: string
  url: string
  vacancyId: string | null
}

interface CreateTailoredApplicationSessionServiceOptions {
  aiWorker: Pick<AiWorkerPreflightService, 'retryAiWorkerPreflight'>
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
  normalizedJson: string
  originalCvId: string
  originalCvText: string
  originalFilename: string
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

interface ValidationContext {
  originalCvText: string
  vacancyText: string
}

const missingGenerationWorker: TailoredApplicationGenerationWorker = {
  runGeneration: () => {
    return Promise.reject(new Error('No tailored-application generation worker is configured.'))
  },
}

export function createTailoredApplicationSessionService({
  aiWorker,
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
    const [normalizedJsonBuffer, originalCvTextBuffer, writingStyleProfileBuffer] =
      await Promise.all([
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
      normalizedJsonBuffer === null ||
      originalCvTextBuffer === null ||
      writingStyleProfileBuffer === null
    ) {
      throw new Error('The selected original CV is incomplete or unavailable.')
    }

    return {
      normalizedJson: normalizedJsonBuffer.toString('utf8'),
      originalCvId: command.originalCvId,
      originalCvText: originalCvTextBuffer.toString('utf8'),
      originalFilename: command.originalCvLabel,
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
        coverLetterPlainTextArtifactName: 'cover-letter.txt',
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
        originalCv.originalCvText,
        'utf8',
      ),
      writeFile(
        path.join(inputDirectoryPath, 'writing-style-profile.json'),
        originalCv.writingStyleProfileJson,
        'utf8',
      ),
      writeFile(path.join(inputDirectoryPath, 'vacancy.json'), vacancy.normalizedJson, 'utf8'),
      writeFile(path.join(inputDirectoryPath, 'vacancy.txt'), vacancy.vacancyText, 'utf8'),
      writeFile(path.join(inputDirectoryPath, 'task.json'), taskJson, 'utf8'),
    ])
  }

  async function persistReadyArtifacts({
    originalCvId,
    result,
    tailoredApplicationId,
    timestamp,
    vacancyId,
  }: {
    originalCvId: string
    result: TailoredApplicationGenerationResult
    tailoredApplicationId: string
    timestamp: string
    vacancyId: string
  }): Promise<void> {
    await localAppData.metadata.put<TailoredApplicationMetadataValue>({
      id: tailoredApplicationId,
      scope: TAILORED_APPLICATION_SCOPE,
      value: {
        createdAt: timestamp,
        originalCvId,
        status: 'ready',
        vacancyId,
      },
    })
    await localAppData.artifacts.write({
      content: Buffer.from(JSON.stringify(result.adaptedCv), 'utf8'),
      id: tailoredApplicationId,
      name: 'adapted-cv.json',
      scope: TAILORED_APPLICATION_SCOPE,
    })
    await localAppData.artifacts.write({
      content: Buffer.from(JSON.stringify(result.coverLetter), 'utf8'),
      id: tailoredApplicationId,
      name: 'cover-letter.json',
      scope: TAILORED_APPLICATION_SCOPE,
    })
    await localAppData.artifacts.write({
      content: Buffer.from(result.coverLetterPlainText, 'utf8'),
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
        createdAt: timestamp,
        originalCvId,
        status: 'generating',
        vacancyId,
      },
    })
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
      const result = await worker.runGeneration({
        runDirectoryPath,
        signal: activeAbortController?.signal ?? new AbortController().signal,
      })

      validateTailoredApplicationGenerationResult(result, {
        originalCvText: originalCv.originalCvText,
        vacancyText: vacancy.vacancyText,
      })
      await persistReadyArtifacts({
        originalCvId: command.originalCvId,
        result,
        tailoredApplicationId,
        timestamp,
        vacancyId: command.vacancyId,
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

      if (
        error instanceof Error &&
        error.message === 'Generated tailored application failed validation.'
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
      await readinessStore.setStartupDestination('workspace_active')
    },
    getPendingGenerationCommand: async () => {
      return await readinessStore.getPendingGenerationCommand()
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

      if (vacancyMetadata?.canGenerate !== true || vacancyMetadata.status !== 'ready') {
        throw new Error('Review a complete job vacancy before adapting this CV.')
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
  result: TailoredApplicationGenerationResult,
  context: ValidationContext,
): void {
  const sourceText = `${context.originalCvText}\n${context.vacancyText}`
  const outputText = collectOutputText(result)

  if (!looksLikeEnglishText(context.originalCvText) || !looksLikeEnglishText(context.vacancyText)) {
    throw new Error('Generated tailored application failed validation.')
  }

  if (!looksLikeEnglishText(outputText)) {
    throw new Error('Generated tailored application failed validation.')
  }

  validateAdaptedCvModel(result.adaptedCv)
  validateCoverLetterModel(result.coverLetter)
  validateAdaptationSummary(result.adaptationSummary)

  if (buildCoverLetterPlainText(result.coverLetter) !== result.coverLetterPlainText) {
    throw new Error('Generated tailored application failed validation.')
  }

  validateGroundedText(result.adaptedCv.headline, sourceText)
  validateGroundedText(result.adaptedCv.summary, sourceText)

  for (const experienceHighlight of result.adaptedCv.experienceHighlights) {
    for (const bullet of experienceHighlight.bullets) {
      validateGroundedText(bullet, sourceText)
    }
  }

  for (const skill of result.adaptedCv.skills) {
    validateGroundedText(skill, sourceText)
  }

  validateGroundedText(result.coverLetter.opening, sourceText)

  for (const paragraph of result.coverLetter.body) {
    validateGroundedText(paragraph, sourceText)
  }

  validateGroundedText(result.coverLetter.closing, sourceText)

  for (const item of result.adaptationSummary.emphasized) {
    validateGroundedText(item, sourceText)
  }

  for (const item of result.adaptationSummary.omitted) {
    validateGroundedText(item, sourceText)
  }

  if (!isBritishFormattedDate(result.coverLetter.date)) {
    throw new Error('Generated tailored application failed validation.')
  }

  if (containsAmericanSpelling(outputText)) {
    throw new Error('Generated tailored application failed validation.')
  }

  validateNumericClaims(
    outputText,
    sourceText,
    new Set(outputTextTokenMatches(result.coverLetter.date, /\b\d[\d,.%]*\b/giu)),
  )
}

function validateAdaptedCvModel(adaptedCv: AdaptedCvModel): void {
  if (
    adaptedCv.candidateName.trim() === '' ||
    adaptedCv.experienceHighlights.length === 0 ||
    adaptedCv.skills.length === 0
  ) {
    throw new Error('Generated tailored application failed validation.')
  }
}

function validateCoverLetterModel(coverLetter: CoverLetterModel): void {
  if (
    coverLetter.greeting.trim() === '' ||
    coverLetter.signature.trim() === '' ||
    coverLetter.body.length === 0
  ) {
    throw new Error('Generated tailored application failed validation.')
  }
}

function validateAdaptationSummary(adaptationSummary: AdaptationSummaryModel): void {
  if (
    adaptationSummary.emphasized.length === 0 ||
    adaptationSummary.gaps.length === 0 ||
    adaptationSummary.validationHints.length === 0
  ) {
    throw new Error('Generated tailored application failed validation.')
  }
}

function validateGroundedText(groundedText: GroundedText, sourceText: string): void {
  if (groundedText.text.trim() === '' || groundedText.sourceEvidence.length === 0) {
    throw new Error('Generated tailored application failed validation.')
  }

  for (const sourceEvidence of groundedText.sourceEvidence) {
    if (sourceEvidence.trim() === '' || !sourceText.includes(sourceEvidence)) {
      throw new Error('Generated tailored application failed validation.')
    }
  }
}

function validateNumericClaims(
  outputText: string,
  sourceText: string,
  allowedNumbers: Set<string>,
): void {
  const sourceNumbers = new Set(outputTextTokenMatches(sourceText, /\b\d[\d,.%]*\b/giu))

  for (const token of outputTextTokenMatches(outputText, /\b\d[\d,.%]*\b/giu)) {
    if (!sourceNumbers.has(token) && !allowedNumbers.has(token)) {
      throw new Error('Generated tailored application failed validation.')
    }
  }
}

function collectOutputText(result: TailoredApplicationGenerationResult): string {
  return [
    result.adaptedCv.candidateName,
    result.adaptedCv.headline.text,
    result.adaptedCv.summary.text,
    ...result.adaptedCv.experienceHighlights.flatMap((experienceHighlight) => {
      return [
        experienceHighlight.heading,
        ...experienceHighlight.bullets.map((bullet) => {
          return bullet.text
        }),
      ]
    }),
    ...result.adaptedCv.skills.map((skill) => {
      return skill.text
    }),
    result.coverLetter.date,
    result.coverLetter.greeting,
    result.coverLetter.opening.text,
    ...result.coverLetter.body.map((paragraph) => {
      return paragraph.text
    }),
    result.coverLetter.closing.text,
    result.coverLetter.signature,
    result.coverLetterPlainText,
    ...result.adaptationSummary.emphasized.map((item) => {
      return item.text
    }),
    ...result.adaptationSummary.omitted.map((item) => {
      return item.text
    }),
    ...result.adaptationSummary.gaps,
    ...result.adaptationSummary.validationHints,
  ].join('\n')
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

function looksLikeEnglishText(text: string): boolean {
  const normalizedText = text.toLowerCase()
  const markerMatches = ENGLISH_MARKERS.filter((marker) => {
    return normalizedText.includes(marker)
  })

  return markerMatches.length >= 2
}

function isBritishFormattedDate(value: string): boolean {
  const pattern = /^(\d{1,2}) ([A-Z][a-z]+) (\d{4})$/u
  const match = pattern.exec(value)

  if (match === null) {
    return false
  }

  return BRITISH_MONTH_NAMES.includes(match[2] as (typeof BRITISH_MONTH_NAMES)[number])
}

function containsAmericanSpelling(text: string): boolean {
  return AMERICAN_SPELLING_PATTERNS.some((pattern) => {
    return pattern.test(text)
  })
}

function outputTextTokenMatches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => {
    return match[0]
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
