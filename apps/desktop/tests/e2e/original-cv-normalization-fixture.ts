export function createOriginalCvNormalizationFixtureOutput(
  overrides?: Partial<{
    experience: {
      dateRange: string;
      employer: string;
      roleTitle: string;
      summary: string;
    }[];
    headline: string;
    skills: string[];
    summary: string;
  }>,
): string {
  return JSON.stringify({
    normalizedCv: {
      contact: {
        email: '',
        location: '',
        phone: '',
        professionalLink: '',
      },
      experience: overrides?.experience ?? [
        {
          dateRange: '2022 — Present',
          employer: 'Analytical Engines Ltd',
          roleTitle: 'Principal Product Designer',
          summary: 'Led product design for AI-assisted desktop tooling.',
        },
      ],
      fullName: 'Ada Lovelace',
      headline: overrides?.headline ?? 'Principal Product Designer',
      skills: overrides?.skills ?? ['Product strategy', 'UX research', 'Prototyping'],
      summary:
        overrides?.summary ??
        'Design leader focused on complex workflow products for technical users.',
    },
    writingStyle: {
      averageSentenceLength: 7,
      clicheDetections: [],
      firstPersonUsage: 'absent',
      formality: 'direct',
    },
  });
}
