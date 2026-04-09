import { expect, test } from 'vitest'

import { assessEnglishLanguageSupport } from '../language-support.js'

test('classifies structured English vacancy text as supported', () => {
  const assessment = assessEnglishLanguageSupport(
    [
      'Senior platform engineer',
      'Example Labs',
      'London, United Kingdom',
      '',
      'Responsibilities',
      'Lead product design for AI-assisted desktop workflows.',
      'Partner with engineering and research teams.',
      '',
      'Requirements',
      'Experience shipping workflow software.',
      'Strong written communication.',
    ].join('\n'),
  )

  expect(assessment.status).toBe('supported')
  expect(assessment.englishSignalCount).toBeGreaterThan(assessment.nonEnglishSignalCount)
})

test('classifies structured Spanish vacancy text as blocked', () => {
  const assessment = assessEnglishLanguageSupport(
    [
      'Ingeniero de plataforma',
      'Example Labs',
      'Madrid, España',
      '',
      'Responsabilidades',
      'Diseñar productos para usuarios técnicos con equipos de ingeniería.',
      'Colaborar con investigación y operaciones.',
      '',
      'Requisitos',
      'Experiencia enviando software de flujo de trabajo.',
      'Comunicación escrita sólida.',
    ].join('\n'),
  )

  expect(assessment.status).toBe('blocked')
  expect(assessment.nonEnglishSignalCount).toBeGreaterThan(assessment.englishSignalCount)
})

test('treats short ambiguous text as undetermined instead of blocked', () => {
  expect(assessEnglishLanguageSupport('Example Labs role overview').status).toBe('undetermined')
})
