export function createOriginalCvNormalizationFixtureOutput(): string {
  return JSON.stringify({
    normalizedCv: {
      experience: [
        'Product Designer | Analytical Engines Ltd',
        'Designed desktop tooling and CV workflows for complex authoring tools.',
      ],
      fullName: 'Ada Lovelace',
      headline: 'Product Designer',
      skills: ['Product design', 'Desktop tooling', 'Analytical Engines'],
      summary: 'Product designer focused on desktop tooling for complex workflow products.',
    },
    writingStyle: {
      averageSentenceLength: 7,
      clicheDetections: [],
      firstPersonUsage: 'absent',
      formality: 'direct',
    },
  })
}
