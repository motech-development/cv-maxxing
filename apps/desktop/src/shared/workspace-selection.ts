export type JobsWorkspaceSelection =
  | {
      kind: 'draft'
    }
  | {
      kind: 'none'
    }
  | {
      kind: 'tailored_application'
      tailoredApplicationId: string
    }

export type OriginalCvWorkspaceSelection =
  | {
      kind: 'active_original_cv'
    }
  | {
      kind: 'none'
    }

export type WorkspaceTopLevelSection = 'job_vacancies' | 'original_cv' | 'settings'

export interface WorkspaceSelection {
  jobs: JobsWorkspaceSelection
  originalCv: OriginalCvWorkspaceSelection
  topLevelSection: WorkspaceTopLevelSection
}

export function createDefaultWorkspaceSelection(): WorkspaceSelection {
  return {
    jobs: {
      kind: 'none',
    },
    originalCv: {
      kind: 'none',
    },
    topLevelSection: 'job_vacancies',
  }
}
