export interface WritingStyleProfile {
  averageSentenceLength: number
  clicheDetections: string[]
  firstPersonUsage: 'absent' | 'mixed' | 'present'
  formality: 'conversational' | 'direct' | 'formal'
}

export const TAILORED_APPLICATION_STYLE_VALIDATION_ERROR_MESSAGE =
  'Generated tailored application failed style validation.'

const GENERIC_CLICHE_PATTERNS = [
  /\bexcited to apply\b/iu,
  /\bpassionate\b/iu,
  /\bresults-driven\b/iu,
  /\bthrilled to apply\b/iu,
  /\bworld-class\b/iu,
] as const

const FIRST_PERSON_PATTERN = /\b(i|me|my|mine|we|our|ours)\b/iu

export function parseWritingStyleProfileJson(profileJson: string): WritingStyleProfile {
  const parsedProfile = JSON.parse(profileJson) as unknown

  if (!isWritingStyleProfile(parsedProfile)) {
    throw new Error(TAILORED_APPLICATION_STYLE_VALIDATION_ERROR_MESSAGE)
  }

  return parsedProfile
}

export function validateTailoredApplicationWritingStyle({
  adaptedCvText,
  coverLetterText,
  profile,
}: {
  adaptedCvText: string
  coverLetterText: string
  profile: WritingStyleProfile
}): void {
  validateAdaptedCvNarrative({
    adaptedCvText,
    profile,
  })
  validateCoverLetterCliches({
    coverLetterText,
    profile,
  })
}

function isWritingStyleProfile(value: unknown): value is WritingStyleProfile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.averageSentenceLength === 'number' &&
    Array.isArray(candidate.clicheDetections) &&
    candidate.clicheDetections.every((item) => {
      return typeof item === 'string'
    }) &&
    (candidate.firstPersonUsage === 'absent' ||
      candidate.firstPersonUsage === 'mixed' ||
      candidate.firstPersonUsage === 'present') &&
    (candidate.formality === 'conversational' ||
      candidate.formality === 'direct' ||
      candidate.formality === 'formal')
  )
}

function validateAdaptedCvNarrative({
  adaptedCvText,
  profile,
}: {
  adaptedCvText: string
  profile: WritingStyleProfile
}): void {
  const adaptedCvHasFirstPerson = FIRST_PERSON_PATTERN.test(adaptedCvText)

  if (profile.firstPersonUsage === 'absent' && adaptedCvHasFirstPerson) {
    throw new Error(TAILORED_APPLICATION_STYLE_VALIDATION_ERROR_MESSAGE)
  }

  const adaptedCvSentenceLength = estimateAverageSentenceLength(adaptedCvText)

  if (
    profile.formality === 'direct' &&
    adaptedCvSentenceLength > Math.max(profile.averageSentenceLength + 8, 16)
  ) {
    throw new Error(TAILORED_APPLICATION_STYLE_VALIDATION_ERROR_MESSAGE)
  }
}

function validateCoverLetterCliches({
  coverLetterText,
  profile,
}: {
  coverLetterText: string
  profile: WritingStyleProfile
}): void {
  const lowerCaseCoverLetter = coverLetterText.toLowerCase()
  const profileSpecificClichePatterns = profile.clicheDetections.map((phrase) => {
    return new RegExp(String.raw`\b${escapeRegExp(phrase)}\b`, 'iu')
  })

  for (const pattern of [...GENERIC_CLICHE_PATTERNS, ...profileSpecificClichePatterns]) {
    if (pattern.test(lowerCaseCoverLetter)) {
      throw new Error(TAILORED_APPLICATION_STYLE_VALIDATION_ERROR_MESSAGE)
    }
  }
}

function estimateAverageSentenceLength(text: string): number {
  const sentenceLengths = text
    .split(/[.!?]+/u)
    .map((sentence) => {
      return sentence.trim()
    })
    .filter((sentence) => {
      return sentence !== ''
    })
    .map((sentence) => {
      return sentence.split(/\s+/u).filter((word) => {
        return word !== ''
      }).length
    })

  if (sentenceLengths.length === 0) {
    return 0
  }

  return Math.round(
    sentenceLengths.reduce((total, sentenceLength) => {
      return total + sentenceLength
    }, 0) / sentenceLengths.length,
  )
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}
