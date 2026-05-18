import { randomUUID } from 'node:crypto';

import {
  assessEnglishLanguageSupport,
  VACANCY_LANGUAGE_BLOCK_MESSAGE,
} from '../shared/language-support.js';
import type {
  VacancyIngestResult,
  VacancyInputType,
  VacancyReviewState,
  VacancySource,
  VacancySummary,
  VacancyWorkspaceState,
} from '../shared/vacancy.js';
import {
  createDefaultWorkspaceSelection,
  type JobsWorkspaceSelection,
} from '../shared/workspace-selection.js';
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js';
import type { VacancyBrowserReadingActionRequest } from './vacancy-browser-actions.js';
import type { VacancyBrowserPageSnapshot } from './vacancy-browser-session-service.js';
import { VacancyNormalizationError } from './vacancy-normalization-error.js';
import type {
  NormalizedVacancy,
  VacancyNormalizationService,
} from './vacancy-normalization-service.js';
import { extractTextFromHtml, sanitizeSnapshotHtml } from './vacancy-page-content.js';
import type { WorkspaceSelectionStore } from './workspace-selection-store.js';

const VACANCY_DRAFT_SCOPE = 'vacancy-workspace';
const VACANCY_SCOPE = 'vacancies';
const VACANCY_WORKSPACE_RECORD_ID = 'current';
const OPEN_JOB_PAGE_BLOCKING_REASON =
  'This job page may need more access. Open the job page or paste the job description instead.';
const RELOAD_JOB_PAGE_BLOCKING_REASON =
  'Open the job page and close it after the full details load, or paste the job description instead.';
const INCOMPLETE_VACANCY_BLOCKING_REASON =
  'Add the full job responsibilities or requirements before tailoring your CV.';
const MIN_RENDERED_PAGE_TEXT_LENGTH = 40;
const TERMINAL_RENDERED_PAGE_PATTERNS = [
  /\b(?:captcha|verify you are human)\b/iu,
  /\b(?:accept cookies|cookie consent|cookie settings)\b/iu,
  /\b(?:log in|login|sign in|signin)\b/iu,
  /\b(?:not found|page unavailable|access denied)\b/iu,
] as const;
const TRANSIENT_RENDERED_PAGE_PATTERNS = [
  /^\s*(?:loading|please wait|redirecting)(?:[\s.]+|$)/iu,
  /\bloading\s+(?:job|role|vacancy|details)\b/iu,
] as const;
const VACANCY_RENDERED_PAGE_EVIDENCE_PATTERNS = [
  /\b(?:about the role|job description|requirements|responsibilities|qualifications)\b/iu,
  /\b(?:what you(?:'|\u2019)ll do|what you will do|what we are looking for)\b/iu,
] as const;
const GENERIC_CAREERS_SHELL_PATTERNS = [
  /\bcareers?\b/iu,
  /\b(?:available roles|job openings|open positions)\b/iu,
  /\b(?:benefits|interview guidance|explore teams)\b/iu,
] as const;

interface VacancyServiceDependencies {
  captureVacancyBrowserSessionPage?: (input: {
    readingActions?: VacancyBrowserReadingActionRequest[];
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean;
    url: string;
  }) => Promise<VacancyBrowserPageSnapshot | null>;
  generateId?: () => string;
  getCurrentTimestamp?: () => string;
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>;
  normalizationService: VacancyNormalizationService;
  openVacancyBrowserSession: (input: {
    readingActions?: VacancyBrowserReadingActionRequest[];
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean;
    url: string;
  }) => Promise<VacancyBrowserPageSnapshot | null>;
  workspaceSelectionStore?: Pick<WorkspaceSelectionStore, 'getSelection' | 'setSelection'>;
}

interface VacancyMetadataValue extends Record<string, JsonValue> {
  blockingReason: string | null;
  canGenerate: boolean;
  employer: string | null;
  fetchedAt: string;
  inputType: VacancyInputType;
  location: string | null;
  originalUrl: string | null;
  requirements: string[];
  resolvedUrl: string | null;
  responsibilities: string[];
  source: VacancySource;
  status: 'incomplete' | 'ready';
  textPreview: string;
  title: string | null;
}

interface VacancyDraftMetadataValue extends Record<string, JsonValue> {
  reviewState: VacancyReviewState | null;
  text: string;
  url: string;
  vacancyId: string | null;
}

export interface VacancyService {
  resetWorkspaceState: () => Promise<void>;
  getWorkspaceState: () => Promise<VacancyWorkspaceState>;
  ingestPastedVacancy: (input: { text: string; url?: string }) => Promise<VacancyIngestResult>;
  ingestVacancyUrl: (input: { url: string }) => Promise<VacancyIngestResult>;
  openBrowserSession: (input: { url: string }) => Promise<VacancyIngestResult>;
}

export function createVacancyService({
  captureVacancyBrowserSessionPage = () => Promise.resolve(null),
  generateId = randomUUID,
  getCurrentTimestamp = () => {
    return new Date().toISOString();
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
      });

      await persistJobsWorkspaceSelection({
        jobs: {
          kind: 'none',
        },
        workspaceSelectionStore,
      });
    },
    getWorkspaceState: async (): Promise<VacancyWorkspaceState> => {
      const draftRecord = await localAppData.metadata.get<VacancyDraftMetadataValue>({
        id: VACANCY_WORKSPACE_RECORD_ID,
        scope: VACANCY_DRAFT_SCOPE,
      });

      if (draftRecord?.vacancyId === null || draftRecord?.vacancyId === undefined) {
        return {
          draft: {
            text: draftRecord?.text ?? '',
            url: draftRecord?.url ?? '',
          },
          reviewState: 'editable',
          vacancy: null,
        };
      }

      return await buildVacancyWorkspaceState({
        draftRecord,
        localAppData,
      });
    },
    ingestPastedVacancy: async ({
      text,
      url,
    }: {
      text: string;
      url?: string;
    }): Promise<VacancyIngestResult> => {
      const trimmedText = text.trim();
      const normalizedUrl = normalizeUrl(url);
      const source = normalizedUrl ? resolveSubmittedUrlSource(normalizedUrl) : 'generic';
      const vacancyId = generateId();
      const fetchedAt = getCurrentTimestamp();
      let normalizedVacancy: NormalizedVacancy;

      try {
        normalizedVacancy = await normalizationService.normalizeVacancy({
          html: createPastedVacancyHtml(trimmedText),
          inputType: 'pasted_text',
          originalUrl: normalizedUrl,
          pageTitle: null,
          resolvedUrl: normalizedUrl,
          source,
        });
      } catch (error) {
        if (!isNoJobContentNormalizationError(error)) {
          throw error;
        }

        return await createPastedNoJobContentResult({
          fetchedAt,
          localAppData,
          normalizedUrl,
          source,
          text: trimmedText,
          vacancyId,
          workspaceSelectionStore,
        });
      }

      const extractedText = normalizedVacancy.bodyText.trim();
      const isLanguageBlocked = assessEnglishLanguageSupport(extractedText).status === 'blocked';
      const canGenerate = !isLanguageBlocked && isVacancyReady(normalizedVacancy);
      let blockingReason: string | null = null;

      if (isLanguageBlocked) {
        blockingReason = VACANCY_LANGUAGE_BLOCK_MESSAGE;
      } else if (!canGenerate) {
        blockingReason = INCOMPLETE_VACANCY_BLOCKING_REASON;
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
      });

      await localAppData.metadata.put({
        id: vacancyId,
        scope: VACANCY_SCOPE,
        value: toVacancyMetadataValue(vacancy),
      });
      await localAppData.artifacts.write({
        content: Buffer.from(extractedText, 'utf8'),
        id: vacancyId,
        name: 'extracted.txt',
        scope: VACANCY_SCOPE,
      });
      await localAppData.artifacts.write({
        content: Buffer.from(JSON.stringify(normalizedVacancy), 'utf8'),
        id: vacancyId,
        name: 'normalized.json',
        scope: VACANCY_SCOPE,
      });
      await localAppData.metadata.put({
        id: VACANCY_WORKSPACE_RECORD_ID,
        scope: VACANCY_DRAFT_SCOPE,
        value: {
          reviewState: canGenerate ? 'reviewed' : 'editable',
          text: trimmedText,
          url: normalizedUrl ?? '',
          vacancyId,
        } satisfies VacancyDraftMetadataValue,
      });
      await persistJobsWorkspaceSelection({
        jobs: {
          kind: 'draft',
        },
        workspaceSelectionStore,
      });

      const workspaceState = await thisGetWorkspaceState(localAppData);

      return {
        kind: canGenerate ? 'ingested' : 'incomplete',
        vacancy,
        workspaceState,
      };
    },
    ingestVacancyUrl: async ({ url }: { url: string }): Promise<VacancyIngestResult> => {
      const normalizedUrl = requireUrl(url);
      const source = resolveSubmittedUrlSource(normalizedUrl);
      const shouldCapturePage = createVacancyPageMatcher(normalizedUrl);

      await persistVacancyWorkspaceDraft({
        localAppData,
        url: normalizedUrl,
      });
      await persistJobsWorkspaceSelection({
        jobs: {
          kind: 'draft',
        },
        workspaceSelectionStore,
      });

      const capturedBrowserSnapshot = await captureVacancyBrowserSessionPage({
        shouldCapturePage,
        url: normalizedUrl,
      });

      const usableBrowserSnapshot = await resolveUsableBrowserSnapshot({
        capturedBrowserSnapshot,
        captureVacancyBrowserSessionPage,
        normalizedUrl,
        openVacancyBrowserSession,
        shouldCapturePage,
      });

      if (usableBrowserSnapshot === null) {
        return await createInteractiveBrowserFallbackResult({
          getCurrentTimestamp,
          localAppData,
          originalUrl: normalizedUrl,
          source,
        });
      }

      const result = await persistFetchedVacancyPageWithAiReadingRetry({
        captureVacancyBrowserSessionPage,
        fetchedPage: usableBrowserSnapshot,
        generateId,
        getCurrentTimestamp,
        localAppData,
        normalizationService,
        originalUrl: normalizedUrl,
        shouldCapturePage,
        source,
        workspaceSelectionStore,
      });

      if (result === null) {
        return await createInteractiveBrowserFallbackResult({
          getCurrentTimestamp,
          localAppData,
          originalUrl: normalizedUrl,
          source,
        });
      }

      return result;
    },
    openBrowserSession: async ({ url }: { url: string }): Promise<VacancyIngestResult> => {
      const normalizedUrl = requireUrl(url);
      const source = resolveSubmittedUrlSource(normalizedUrl);
      const shouldCapturePage = createVacancyPageMatcher(normalizedUrl);

      await persistVacancyWorkspaceDraft({
        localAppData,
        url: normalizedUrl,
      });

      await openVacancyBrowserSession({
        shouldCapturePage,
        url: normalizedUrl,
      });

      const browserSnapshot = await captureVacancyBrowserSessionPage({
        shouldCapturePage,
        url: normalizedUrl,
      });

      if (browserSnapshot === null || !shouldCapturePage(browserSnapshot)) {
        const incompleteVacancy = createBlockedVacancySummary({
          blockingReason: RELOAD_JOB_PAGE_BLOCKING_REASON,
          fetchedAt: getCurrentTimestamp(),
          inputType: 'url',
          originalUrl: normalizedUrl,
          source,
        });

        await persistJobsWorkspaceSelection({
          jobs: {
            kind: 'draft',
          },
          workspaceSelectionStore,
        });

        return {
          kind: 'incomplete',
          vacancy: incompleteVacancy,
          workspaceState: await thisGetWorkspaceState(localAppData),
        };
      }

      const result = await persistFetchedVacancyPageWithAiReadingRetry({
        captureVacancyBrowserSessionPage,
        fetchedPage: browserSnapshot,
        generateId,
        getCurrentTimestamp,
        localAppData,
        normalizationService,
        originalUrl: normalizedUrl,
        shouldCapturePage,
        source,
        workspaceSelectionStore,
      });

      if (result !== null) {
        return result;
      }

      const incompleteVacancy = createBlockedVacancySummary({
        blockingReason: RELOAD_JOB_PAGE_BLOCKING_REASON,
        fetchedAt: getCurrentTimestamp(),
        inputType: 'url',
        originalUrl: normalizedUrl,
        source,
      });

      await persistVacancyWorkspaceDraft({
        localAppData,
        url: normalizedUrl,
      });
      await persistJobsWorkspaceSelection({
        jobs: {
          kind: 'draft',
        },
        workspaceSelectionStore,
      });

      return {
        kind: 'incomplete',
        vacancy: incompleteVacancy,
        workspaceState: await thisGetWorkspaceState(localAppData),
      };
    },
  };
}

async function createPastedNoJobContentResult({
  fetchedAt,
  localAppData,
  normalizedUrl,
  source,
  text,
  vacancyId,
  workspaceSelectionStore,
}: {
  fetchedAt: string;
  localAppData: Pick<LocalAppDataStore, 'metadata'>;
  normalizedUrl: string | null;
  source: VacancySource;
  text: string;
  vacancyId: string;
  workspaceSelectionStore?: Pick<WorkspaceSelectionStore, 'getSelection' | 'setSelection'>;
}): Promise<VacancyIngestResult> {
  const vacancy: VacancySummary = {
    blockingReason: INCOMPLETE_VACANCY_BLOCKING_REASON,
    canGenerate: false,
    employer: null,
    fetchedAt,
    id: vacancyId,
    inputType: 'pasted_text',
    location: null,
    originalUrl: normalizedUrl,
    requirements: [],
    resolvedUrl: normalizedUrl,
    responsibilities: [],
    source,
    status: 'incomplete',
    textPreview: '',
    title: null,
  };

  await localAppData.metadata.put({
    id: VACANCY_WORKSPACE_RECORD_ID,
    scope: VACANCY_DRAFT_SCOPE,
    value: {
      reviewState: 'editable',
      text,
      url: normalizedUrl ?? '',
      vacancyId: null,
    } satisfies VacancyDraftMetadataValue,
  });
  await persistJobsWorkspaceSelection({
    jobs: {
      kind: 'draft',
    },
    workspaceSelectionStore,
  });

  return {
    kind: 'incomplete',
    vacancy,
    workspaceState: await thisGetWorkspaceState(localAppData),
  };
}

async function createInteractiveBrowserFallbackResult({
  getCurrentTimestamp,
  localAppData,
  originalUrl,
  source,
}: {
  getCurrentTimestamp: () => string;
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>;
  originalUrl: string;
  source: VacancySource;
}): Promise<VacancyIngestResult> {
  const incompleteVacancy = createBlockedVacancySummary({
    blockingReason: OPEN_JOB_PAGE_BLOCKING_REASON,
    fetchedAt: getCurrentTimestamp(),
    inputType: 'url',
    originalUrl,
    source,
  });

  return {
    kind: 'incomplete',
    vacancy: incompleteVacancy,
    workspaceState: await thisGetWorkspaceState(localAppData),
  };
}

async function resolveUsableBrowserSnapshot({
  capturedBrowserSnapshot,
  captureVacancyBrowserSessionPage,
  normalizedUrl,
  openVacancyBrowserSession,
  shouldCapturePage,
}: {
  capturedBrowserSnapshot: VacancyBrowserPageSnapshot | null;
  captureVacancyBrowserSessionPage: (input: {
    readingActions?: VacancyBrowserReadingActionRequest[];
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean;
    url: string;
  }) => Promise<VacancyBrowserPageSnapshot | null>;
  normalizedUrl: string;
  openVacancyBrowserSession: (input: {
    readingActions?: VacancyBrowserReadingActionRequest[];
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean;
    url: string;
  }) => Promise<VacancyBrowserPageSnapshot | null>;
  shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean;
}): Promise<VacancyBrowserPageSnapshot | null> {
  if (capturedBrowserSnapshot !== null && shouldCapturePage(capturedBrowserSnapshot)) {
    return capturedBrowserSnapshot;
  }

  await openVacancyBrowserSession({
    shouldCapturePage,
    url: normalizedUrl,
  });

  const retriedBrowserSnapshot = await captureVacancyBrowserSessionPage({
    shouldCapturePage,
    url: normalizedUrl,
  });

  return retriedBrowserSnapshot !== null && shouldCapturePage(retriedBrowserSnapshot)
    ? retriedBrowserSnapshot
    : null;
}

async function persistFetchedVacancyPageWithAiReadingRetry({
  captureVacancyBrowserSessionPage,
  fetchedPage,
  generateId,
  getCurrentTimestamp,
  localAppData,
  normalizationService,
  originalUrl,
  shouldCapturePage,
  source,
  workspaceSelectionStore,
}: {
  captureVacancyBrowserSessionPage: (input: {
    readingActions?: VacancyBrowserReadingActionRequest[];
    shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean;
    url: string;
  }) => Promise<VacancyBrowserPageSnapshot | null>;
  fetchedPage: VacancyBrowserPageSnapshot;
  generateId: () => string;
  getCurrentTimestamp: () => string;
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>;
  normalizationService: VacancyNormalizationService;
  originalUrl: string;
  shouldCapturePage: (snapshot: VacancyBrowserPageSnapshot) => boolean;
  source: VacancySource;
  workspaceSelectionStore?: Pick<WorkspaceSelectionStore, 'getSelection' | 'setSelection'>;
}): Promise<VacancyIngestResult | null> {
  try {
    return await persistFetchedVacancyPage({
      fetchedPage,
      generateId,
      getCurrentTimestamp,
      localAppData,
      normalizationService,
      originalUrl,
      source,
      workspaceSelectionStore,
    });
  } catch (error) {
    if (isNoJobContentNormalizationError(error)) {
      return null;
    }

    if (!isPageInteractionRequestedError(error)) {
      throw error;
    }

    const recapturedPage = await captureVacancyBrowserSessionPage({
      readingActions: error.readingActions,
      shouldCapturePage,
      url: originalUrl,
    });

    if (recapturedPage === null || !shouldCapturePage(recapturedPage)) {
      return null;
    }

    try {
      return await persistFetchedVacancyPage({
        fetchedPage: recapturedPage,
        generateId,
        getCurrentTimestamp,
        localAppData,
        normalizationService,
        originalUrl,
        source,
        workspaceSelectionStore,
      });
    } catch (recaptureError) {
      if (
        isNoJobContentNormalizationError(recaptureError) ||
        isPageInteractionRequestedError(recaptureError)
      ) {
        return null;
      }

      throw recaptureError;
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
  source,
  workspaceSelectionStore,
}: {
  fetchedPage: {
    html: string;
    pageTitle: string | null;
    resolvedUrl: string;
  };
  generateId: () => string;
  getCurrentTimestamp: () => string;
  localAppData: Pick<LocalAppDataStore, 'artifacts' | 'metadata'>;
  normalizationService: VacancyNormalizationService;
  originalUrl: string;
  source: VacancySource;
  workspaceSelectionStore?: Pick<WorkspaceSelectionStore, 'getSelection' | 'setSelection'>;
}): Promise<VacancyIngestResult> {
  const normalizedVacancy = await normalizationService.normalizeVacancy({
    html: fetchedPage.html,
    inputType: 'url',
    originalUrl,
    pageTitle: fetchedPage.pageTitle,
    resolvedUrl: fetchedPage.resolvedUrl,
    source,
  });
  const vacancyId = generateId();
  const fetchedAt = getCurrentTimestamp();
  const extractedText = normalizedVacancy.bodyText.trim();
  const isLanguageBlocked = assessEnglishLanguageSupport(extractedText).status === 'blocked';
  const canGenerate = !isLanguageBlocked && isVacancyReady(normalizedVacancy);
  let blockingReason: string | null = null;

  if (isLanguageBlocked) {
    blockingReason = VACANCY_LANGUAGE_BLOCK_MESSAGE;
  } else if (!canGenerate) {
    blockingReason = INCOMPLETE_VACANCY_BLOCKING_REASON;
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
      title: normalizedVacancy.title,
    },
  });

  await localAppData.metadata.put({
    id: vacancyId,
    scope: VACANCY_SCOPE,
    value: toVacancyMetadataValue(vacancy),
  });
  await localAppData.artifacts.write({
    content: Buffer.from(sanitizeSnapshotHtml(fetchedPage.html), 'utf8'),
    id: vacancyId,
    name: 'snapshot.html',
    scope: VACANCY_SCOPE,
  });
  await localAppData.artifacts.write({
    content: Buffer.from(extractedText, 'utf8'),
    id: vacancyId,
    name: 'extracted.txt',
    scope: VACANCY_SCOPE,
  });
  await localAppData.artifacts.write({
    content: Buffer.from(JSON.stringify(normalizedVacancy), 'utf8'),
    id: vacancyId,
    name: 'normalized.json',
    scope: VACANCY_SCOPE,
  });
  await localAppData.metadata.put({
    id: VACANCY_WORKSPACE_RECORD_ID,
    scope: VACANCY_DRAFT_SCOPE,
    value: {
      reviewState: canGenerate ? 'reviewed' : 'editable',
      text: '',
      url: originalUrl,
      vacancyId,
    } satisfies VacancyDraftMetadataValue,
  });
  await persistJobsWorkspaceSelection({
    jobs: {
      kind: 'draft',
    },
    workspaceSelectionStore,
  });

  return {
    kind: canGenerate ? 'ingested' : 'incomplete',
    vacancy,
    workspaceState: await thisGetWorkspaceState(localAppData),
  };
}

async function persistJobsWorkspaceSelection({
  jobs,
  workspaceSelectionStore,
}: {
  jobs: JobsWorkspaceSelection;
  workspaceSelectionStore?: Pick<WorkspaceSelectionStore, 'getSelection' | 'setSelection'>;
}): Promise<void> {
  if (workspaceSelectionStore === undefined) {
    return;
  }

  const currentSelection =
    (await workspaceSelectionStore.getSelection()) ?? createDefaultWorkspaceSelection();

  await workspaceSelectionStore.setSelection({
    ...currentSelection,
    jobs,
    topLevelSection: 'job_vacancies',
  });
}

function createBlockedVacancySummary({
  blockingReason,
  fetchedAt,
  inputType,
  originalUrl,
  source,
}: {
  blockingReason: string;
  fetchedAt: string;
  inputType: VacancyInputType;
  originalUrl: string;
  source: VacancySource;
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
  };
}

async function thisGetWorkspaceState(
  localAppData: Pick<LocalAppDataStore, 'metadata'>,
): Promise<VacancyWorkspaceState> {
  const draftRecord = await localAppData.metadata.get<VacancyDraftMetadataValue>({
    id: VACANCY_WORKSPACE_RECORD_ID,
    scope: VACANCY_DRAFT_SCOPE,
  });

  if (draftRecord?.vacancyId === null || draftRecord?.vacancyId === undefined) {
    return {
      draft: {
        text: draftRecord?.text ?? '',
        url: draftRecord?.url ?? '',
      },
      reviewState: 'editable',
      vacancy: null,
    };
  }

  return await buildVacancyWorkspaceState({
    draftRecord,
    localAppData,
  });
}

async function persistVacancyWorkspaceDraft({
  localAppData,
  url,
}: {
  localAppData: Pick<LocalAppDataStore, 'metadata'>;
  url: string;
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
  });
}

async function buildVacancyWorkspaceState({
  draftRecord,
  localAppData,
}: {
  draftRecord: VacancyDraftMetadataValue;
  localAppData: Pick<LocalAppDataStore, 'metadata'>;
}): Promise<VacancyWorkspaceState> {
  if (draftRecord.vacancyId === null) {
    return {
      draft: {
        text: draftRecord.text,
        url: draftRecord.url,
      },
      reviewState: 'editable',
      vacancy: null,
    };
  }

  const vacancyRecord = await localAppData.metadata.get<VacancyMetadataValue>({
    id: draftRecord.vacancyId,
    scope: VACANCY_SCOPE,
  });
  const vacancy =
    vacancyRecord === null
      ? null
      : toVacancySummary({
          id: draftRecord.vacancyId,
          metadata: vacancyRecord,
        });

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
  };
}

function resolveVacancyReviewState({
  draftRecord,
  vacancyRecord,
}: {
  draftRecord: VacancyDraftMetadataValue;
  vacancyRecord: VacancyMetadataValue | null;
}): VacancyReviewState {
  if (vacancyRecord === null) {
    return 'editable';
  }

  if (draftRecord.reviewState === 'reviewed') {
    return 'reviewed';
  }

  if (draftRecord.reviewState === 'editable') {
    return 'editable';
  }

  if (vacancyRecord.canGenerate && vacancyRecord.status === 'ready') {
    return 'reviewed';
  }

  return 'editable';
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
  };
}

function toVacancySummary({
  id,
  metadata,
}: {
  id: string;
  metadata: VacancyMetadataValue;
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
  };
}

function createVacancyPageMatcher(
  originalUrl: string,
): (snapshot: VacancyBrowserPageSnapshot) => boolean {
  return (snapshot) => {
    return isExpectedBrowserSessionVacancyPage({
      html: snapshot.html,
      originalUrl,
      pageTitle: snapshot.pageTitle,
      resolvedUrl: snapshot.resolvedUrl,
    });
  };
}

function isExpectedBrowserSessionVacancyPage({
  html,
  originalUrl,
  pageTitle,
  resolvedUrl,
}: {
  html: string;
  originalUrl: string;
  pageTitle: string | null;
  resolvedUrl: string;
}) {
  try {
    const requestedUrl = new URL(originalUrl);
    const currentUrl = new URL(resolvedUrl);
    const isResolvedUrlMatch =
      normalizeComparableHostname(currentUrl.hostname) ===
        normalizeComparableHostname(requestedUrl.hostname) &&
      normalizeComparablePathname(currentUrl.pathname) ===
        normalizeComparablePathname(requestedUrl.pathname) &&
      currentUrl.search === requestedUrl.search;

    return (
      isResolvedUrlMatch &&
      hasRenderedPageEvidence({
        html,
        pageTitle,
      })
    );
  } catch {
    return false;
  }
}

function hasRenderedPageEvidence({ html, pageTitle }: { html: string; pageTitle: string | null }) {
  const extractedText = extractTextFromHtml(sanitizeSnapshotHtml(html));

  if (extractedText === '') {
    return false;
  }

  if (TERMINAL_RENDERED_PAGE_PATTERNS.some((pattern) => pattern.test(extractedText))) {
    return true;
  }

  if (
    TRANSIENT_RENDERED_PAGE_PATTERNS.some((pattern) => {
      return pattern.test(extractedText) || (pageTitle !== null && pattern.test(pageTitle));
    })
  ) {
    return false;
  }

  if (
    looksLikeGenericCareersShell(extractedText) &&
    !hasVacancyRenderedPageEvidence(extractedText)
  ) {
    return false;
  }

  return extractedText.length >= MIN_RENDERED_PAGE_TEXT_LENGTH;
}

function hasVacancyRenderedPageEvidence(extractedText: string) {
  return VACANCY_RENDERED_PAGE_EVIDENCE_PATTERNS.some((pattern) => {
    return pattern.test(extractedText);
  });
}

function looksLikeGenericCareersShell(extractedText: string) {
  const shellSignalsCount = GENERIC_CAREERS_SHELL_PATTERNS.filter((pattern) => {
    return pattern.test(extractedText);
  }).length;

  return shellSignalsCount >= 2;
}

function normalizeComparableHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./u, '');
}

function normalizeComparablePathname(pathname: string) {
  const normalizedPathname = pathname.replace(/\/+$/u, '');

  return normalizedPathname === '' ? '/' : normalizedPathname;
}

function resolveSubmittedUrlSource(url: string): VacancySource {
  return new URL(url).hostname.toLowerCase().replace(/^www\./u, '');
}

function normalizeUrl(url: string | undefined): string | null {
  if (url === undefined || url.trim() === '') {
    return null;
  }

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
}

function isNoJobContentNormalizationError(error: unknown) {
  return error instanceof VacancyNormalizationError && error.code === 'no_job_content';
}

function isPageInteractionRequestedError(error: unknown): error is VacancyNormalizationError & {
  readingActions: VacancyBrowserReadingActionRequest[];
} {
  return (
    error instanceof VacancyNormalizationError &&
    error.code === 'page_interaction_requested' &&
    Array.isArray(error.readingActions) &&
    error.readingActions.length > 0
  );
}

function requireUrl(url: string) {
  const normalizedUrl = normalizeUrl(url);

  if (normalizedUrl === null) {
    throw new TypeError('A vacancy URL is required.');
  }

  return normalizedUrl;
}

function createPastedVacancyHtml(text: string) {
  return `<main><pre>${escapeHtml(text)}</pre></main>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isVacancyReady(vacancy: NormalizedVacancy) {
  const substantiveSectionsCount = vacancy.requirements.length + vacancy.responsibilities.length;

  if (substantiveSectionsCount >= 2 && vacancy.bodyText.length >= 80) {
    return true;
  }

  return vacancy.bodyText.length >= 180;
}
