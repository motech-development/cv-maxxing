import {
  createDefaultWorkspaceSelection,
  type JobsWorkspaceSelection,
  type OriginalCvWorkspaceSelection,
  type WorkspaceSelection,
  type WorkspaceTopLevelSection,
} from '../shared/workspace-selection.js'
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js'

const WORKSPACE_SELECTION_SCOPE = 'workspace-selection'
const WORKSPACE_SELECTION_ENTRY_ID = 'current'

interface TailoredApplicationWorkspaceSelectionValue extends Record<string, JsonValue> {
  kind: 'tailored_application'
  tailoredApplicationId: string
}

type JobsWorkspaceSelectionValue =
  | {
      kind: 'draft'
    }
  | {
      kind: 'none'
    }
  | TailoredApplicationWorkspaceSelectionValue

type OriginalCvWorkspaceSelectionValue =
  | {
      kind: 'active_original_cv'
    }
  | {
      kind: 'none'
    }

interface WorkspaceSelectionValue extends Record<string, JsonValue> {
  jobs: JobsWorkspaceSelectionValue
  originalCv: OriginalCvWorkspaceSelectionValue
  topLevelSection: WorkspaceTopLevelSection
}

export interface WorkspaceSelectionStore {
  getSelection: () => Promise<WorkspaceSelection | null>
  setSelection: (selection: WorkspaceSelection) => Promise<void>
}

export function createWorkspaceSelectionStore({
  localAppData,
}: {
  localAppData: Pick<LocalAppDataStore, 'metadata'>
}): WorkspaceSelectionStore {
  return {
    getSelection: async () => {
      const value: unknown = await localAppData.metadata.get({
        id: WORKSPACE_SELECTION_ENTRY_ID,
        scope: WORKSPACE_SELECTION_SCOPE,
      })

      return normalizeWorkspaceSelection(value)
    },
    setSelection: async (selection) => {
      const value: WorkspaceSelectionValue = {
        jobs:
          selection.jobs.kind === 'tailored_application'
            ? {
                kind: selection.jobs.kind,
                tailoredApplicationId: selection.jobs.tailoredApplicationId,
              }
            : {
                kind: selection.jobs.kind,
              },
        originalCv: {
          kind: selection.originalCv.kind,
        },
        topLevelSection: selection.topLevelSection,
      }

      await localAppData.metadata.put({
        id: WORKSPACE_SELECTION_ENTRY_ID,
        scope: WORKSPACE_SELECTION_SCOPE,
        value,
      })
    },
  }
}

function normalizeWorkspaceSelection(value: unknown): WorkspaceSelection | null {
  const legacyJobsSelection = normalizeLegacyJobsWorkspaceSelection(value)

  if (legacyJobsSelection !== null) {
    return {
      ...createDefaultWorkspaceSelection(),
      jobs: legacyJobsSelection,
    }
  }

  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('jobs' in value) ||
    !('originalCv' in value) ||
    !('topLevelSection' in value)
  ) {
    return null
  }

  const candidate = value as Record<string, unknown>
  const jobsSelection = normalizeLegacyJobsWorkspaceSelection(candidate.jobs)
  const originalCvSelection = normalizeOriginalCvWorkspaceSelection(candidate.originalCv)
  const topLevelSection = normalizeTopLevelSection(candidate.topLevelSection)

  if (jobsSelection === null || originalCvSelection === null || topLevelSection === null) {
    return null
  }

  return {
    jobs: jobsSelection,
    originalCv: originalCvSelection,
    topLevelSection,
  }
}

function normalizeLegacyJobsWorkspaceSelection(value: unknown): JobsWorkspaceSelection | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !('kind' in value)) {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (candidate.kind === 'draft' || candidate.kind === 'none') {
    return {
      kind: candidate.kind,
    }
  }

  if (
    candidate.kind === 'tailored_application' &&
    'tailoredApplicationId' in candidate &&
    typeof candidate.tailoredApplicationId === 'string'
  ) {
    return {
      kind: 'tailored_application',
      tailoredApplicationId: candidate.tailoredApplicationId,
    }
  }

  return null
}

function normalizeOriginalCvWorkspaceSelection(
  value: unknown,
): OriginalCvWorkspaceSelection | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !('kind' in value)) {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (candidate.kind === 'active_original_cv' || candidate.kind === 'none') {
    return {
      kind: candidate.kind,
    }
  }

  return null
}

function normalizeTopLevelSection(value: unknown): WorkspaceTopLevelSection | null {
  if (value === 'job_vacancies' || value === 'original_cv' || value === 'settings') {
    return value
  }

  return null
}
