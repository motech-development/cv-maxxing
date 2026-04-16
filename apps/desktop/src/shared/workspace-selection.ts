export type WorkspaceSelection =
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
