export function createOriginalCvNormalizationFixtureOutput(): string {
  return JSON.stringify({
    normalizedCv: {
      contact: {
        email: '',
        location: '',
        phone: '',
        professionalLink: '',
      },
      experience: [
        'Principal Product Designer | Analytical Engines Ltd | 2022 — Present\nLed product design for AI-assisted desktop tooling.',
      ],
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      skills: ['Product strategy', 'UX research', 'Prototyping'],
      summary: 'Design leader focused on complex workflow products for technical users.',
    },
    writingStyle: {
      averageSentenceLength: 7,
      clicheDetections: [],
      firstPersonUsage: 'absent',
      formality: 'direct',
    },
  })
}
