import type { VacancyBrowserReadingActionRequest } from './vacancy-browser-actions.js';

export type VacancyNormalizationErrorCode =
  | 'cancelled'
  | 'invalid_normalization'
  | 'no_job_content'
  | 'page_interaction_requested'
  | 'semantic_rejection'
  | 'timeout';

export class VacancyNormalizationError extends Error {
  readonly code: VacancyNormalizationErrorCode;
  readonly readingActions: VacancyBrowserReadingActionRequest[];

  override name = 'VacancyNormalizationError';

  constructor({
    code,
    message,
    readingActions = [],
  }: {
    code: VacancyNormalizationErrorCode;
    message: string;
    readingActions?: VacancyBrowserReadingActionRequest[];
  }) {
    super(message);
    this.code = code;
    this.readingActions = readingActions;
  }
}
