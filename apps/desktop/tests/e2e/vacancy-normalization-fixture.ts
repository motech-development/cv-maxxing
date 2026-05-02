interface VacancyNormalizationFixtureOverrides {
  bodyText?: string
  employer?: string | null
  location?: string | null
  requirements?: string[]
  responsibilities?: string[]
  title?: string | null
}

export function createVacancyNormalizationFixtureOutput(
  overrides?: VacancyNormalizationFixtureOverrides,
): string {
  return JSON.stringify({
    kind: 'success',
    normalizedVacancy: {
      bodyText:
        overrides?.bodyText ??
        [
          'Build reliable desktop tooling for technical users.',
          'Partner with design and infrastructure teams.',
          'Experience shipping workflow software.',
          'Strong written communication.',
        ].join(' '),
      employer: overrides?.employer ?? 'Example Labs',
      location: overrides?.location ?? 'London, United Kingdom',
      requirements: overrides?.requirements ?? [
        'Experience shipping workflow software.',
        'Strong written communication.',
      ],
      responsibilities: overrides?.responsibilities ?? [
        'Build reliable desktop tooling for technical users.',
        'Partner with design and infrastructure teams.',
      ],
      title: overrides?.title ?? 'Senior platform engineer',
    },
  })
}

export function createSpanishVacancyNormalizationFixtureOutput(): string {
  return createVacancyNormalizationFixtureOutput({
    bodyText: [
      'Diseñar productos para usuarios técnicos con equipos de ingeniería.',
      'Colaborar con investigación y operaciones.',
      'Experiencia enviando software de flujo de trabajo.',
      'Comunicación escrita sólida.',
    ].join(' '),
    employer: 'Example Labs',
    location: 'Madrid, España',
    requirements: [],
    responsibilities: [],
    title: 'Ingeniero de plataforma',
  })
}
