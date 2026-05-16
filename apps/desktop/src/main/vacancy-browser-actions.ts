export type VacancyBrowserReadingActionRequest =
  | {
      kind: 'click'
      selector: string
    }
  | {
      kind: 'read'
      selector: string
    }
  | {
      kind: 'navigate'
      url: string
    }
  | {
      kind: 'submit'
      selector: string
    }
  | {
      kind: 'type'
      selector: string
      text: string
    }
  | {
      kind: 'upload'
      selector: string
    }
