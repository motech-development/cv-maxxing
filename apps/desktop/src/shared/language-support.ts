export type EnglishLanguageSupportStatus = 'blocked' | 'supported' | 'undetermined'

export interface EnglishLanguageSupportAssessment {
  englishSignalCount: number
  nonEnglishSignalCount: number
  status: EnglishLanguageSupportStatus
}

export const ORIGINAL_CV_LANGUAGE_BLOCK_MESSAGE =
  'CV Maxxing v1 supports British English only. Use an English original CV to continue.'

export const VACANCY_LANGUAGE_BLOCK_MESSAGE =
  'CV Maxxing v1 supports British English only. Review an English job before tailoring your CV.'

const ENGLISH_SIGNAL_WORDS = [
  'summary',
  'experience',
  'skills',
  'responsibilities',
  'requirements',
  'lead',
  'design',
  'product',
  'technical',
  'workflow',
  'communication',
  'engineer',
  'users',
] as const

const NON_ENGLISH_SIGNAL_WORDS = [
  'resumen',
  'habilidades',
  'responsabilidades',
  'requisitos',
  'disenar',
  'usuarios',
  'equipos',
  'ingenieria',
  'investigacion',
  'solida',
  'zusammenfassung',
  'kenntnisse',
  'anforderungen',
  'verantwortlichkeiten',
  'sammanfattning',
  'fardigheter',
  'samenvatting',
  'vaardigheden',
  'competences',
  'exigences',
  'responsabilites',
  'riepilogo',
  'competenze',
  'requisiti',
] as const

export function assessEnglishLanguageSupport(text: string): EnglishLanguageSupportAssessment {
  const normalizedTokens = tokenizeText(text)
  const englishSignalCount = countMatchingSignals(normalizedTokens, ENGLISH_SIGNAL_WORDS)
  const nonEnglishSignalCount = countMatchingSignals(normalizedTokens, NON_ENGLISH_SIGNAL_WORDS)

  if (nonEnglishSignalCount >= 3 && nonEnglishSignalCount > englishSignalCount) {
    return {
      englishSignalCount,
      nonEnglishSignalCount,
      status: 'blocked',
    }
  }

  if (englishSignalCount >= 3 && englishSignalCount >= nonEnglishSignalCount) {
    return {
      englishSignalCount,
      nonEnglishSignalCount,
      status: 'supported',
    }
  }

  if (nonEnglishSignalCount >= 2 && englishSignalCount === 0) {
    return {
      englishSignalCount,
      nonEnglishSignalCount,
      status: 'blocked',
    }
  }

  if (englishSignalCount >= 2 && nonEnglishSignalCount === 0 && normalizedTokens.length >= 6) {
    return {
      englishSignalCount,
      nonEnglishSignalCount,
      status: 'supported',
    }
  }

  return {
    englishSignalCount,
    nonEnglishSignalCount,
    status: 'undetermined',
  }
}

function tokenizeText(text: string): string[] {
  return (
    text
      .normalize('NFKD')
      .replaceAll(/\p{Mark}/gu, '')
      .toLowerCase()
      .match(/\p{Letter}+/gu)
      ?.filter((token) => {
        return token.length >= 3
      }) ?? []
  )
}

function countMatchingSignals(tokens: string[], signals: readonly string[]): number {
  const tokenSet = new Set(tokens)

  return signals.filter((signal) => {
    return tokenSet.has(signal)
  }).length
}
