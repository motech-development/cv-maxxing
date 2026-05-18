export type OriginalCvNormalizationErrorCode = 'invalid_normalization' | 'timeout';

export class OriginalCvNormalizationError extends Error {
  readonly code: OriginalCvNormalizationErrorCode;

  override name = 'OriginalCvNormalizationError';

  constructor({ code, message }: { code: OriginalCvNormalizationErrorCode; message: string }) {
    super(message);
    this.code = code;
  }
}
