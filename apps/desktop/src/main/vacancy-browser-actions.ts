export type VacancyBrowserReadingActionRequest =
  | {
      kind: 'click';
      selector: string;
    }
  | {
      kind: 'read';
      selector: string;
    };
