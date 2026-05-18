export interface WritingStyleProfile {
  averageSentenceLength: number;
  clicheDetections: string[];
  firstPersonUsage: 'absent' | 'mixed' | 'present';
  formality: 'conversational' | 'direct' | 'formal';
}

export const INVALID_WRITING_STYLE_PROFILE_ERROR_MESSAGE =
  'Stored writing style profile is invalid.';

export function parseWritingStyleProfileJson(profileJson: string): WritingStyleProfile {
  let parsedProfile: unknown;

  try {
    parsedProfile = JSON.parse(profileJson) as unknown;
  } catch {
    throw new Error(INVALID_WRITING_STYLE_PROFILE_ERROR_MESSAGE);
  }

  if (!isWritingStyleProfile(parsedProfile)) {
    throw new Error(INVALID_WRITING_STYLE_PROFILE_ERROR_MESSAGE);
  }

  return parsedProfile;
}

function isWritingStyleProfile(value: unknown): value is WritingStyleProfile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.averageSentenceLength === 'number' &&
    Array.isArray(candidate.clicheDetections) &&
    candidate.clicheDetections.every((item) => {
      return typeof item === 'string';
    }) &&
    (candidate.firstPersonUsage === 'absent' ||
      candidate.firstPersonUsage === 'mixed' ||
      candidate.firstPersonUsage === 'present') &&
    (candidate.formality === 'conversational' ||
      candidate.formality === 'direct' ||
      candidate.formality === 'formal')
  );
}
