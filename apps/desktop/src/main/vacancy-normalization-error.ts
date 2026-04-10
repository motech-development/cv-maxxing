export type VacancyNormalizationErrorCode = 'invalid_normalization' | 'timeout'

export class VacancyNormalizationError extends Error {
  readonly code: VacancyNormalizationErrorCode

  override name = 'VacancyNormalizationError'

  constructor({ code, message }: { code: VacancyNormalizationErrorCode; message: string }) {
    super(message)
    this.code = code
  }
}
