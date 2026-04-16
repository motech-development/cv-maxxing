import type { WorkspaceSelection } from '../shared/workspace-selection.js'
import type { JsonValue, LocalAppDataStore } from './local-app-data-service.js'

const WORKSPACE_SELECTION_SCOPE = 'workspace-selection'
const WORKSPACE_SELECTION_ENTRY_ID = 'current'

interface TailoredApplicationWorkspaceSelectionValue extends Record<string, JsonValue> {
  kind: 'tailored_application'
  tailoredApplicationId: string
}

type WorkspaceSelectionValue =
  | {
      kind: 'draft'
    }
  | {
      kind: 'none'
    }
  | TailoredApplicationWorkspaceSelectionValue

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
      const value: WorkspaceSelectionValue =
        selection.kind === 'tailored_application'
          ? {
              kind: selection.kind,
              tailoredApplicationId: selection.tailoredApplicationId,
            }
          : {
              kind: selection.kind,
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
