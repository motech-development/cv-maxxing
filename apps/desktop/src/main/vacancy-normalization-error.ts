export type VacancyNormalizationErrorCode =
  | 'cancelled'
  | 'invalid_normalization'
  | 'no_job_content'
  | 'semantic_rejection'
  | 'timeout'

export class VacancyNormalizationError extends Error {
  readonly code: VacancyNormalizationErrorCode

  override name = 'VacancyNormalizationError'

  constructor({ code, message }: { code: VacancyNormalizationErrorCode; message: string }) {
    super(message)
    this.code = code
  }
}
