import type { NormalizedVacancy } from './vacancy-normalization-service.js';

export const VACANCY_NORMALIZATION_EXAMPLES: readonly {
  normalizedVacancy: NormalizedVacancy;
  title: string;
}[] = [
  {
    normalizedVacancy: {
      bodyText:
        'Lead product design for AI-assisted desktop workflows. Partner with engineering and research to ship workflow software.',
      employer: 'Example Labs',
      location: 'London, United Kingdom',
      requirements: ['Experience shipping workflow software.'],
      responsibilities: ['Lead product design for AI-assisted desktop workflows.'],
      title: 'Senior Product Designer',
    },
    title: 'Main vacancy body recovered from generic job page chrome',
  },
  {
    normalizedVacancy: {
      bodyText:
        'Own workflow tooling for technical teams. Improve operator experiences and document system behaviour.',
      employer: null,
      location: 'Remote (UK)',
      requirements: ['Strong written communication.'],
      responsibilities: ['Own workflow tooling for technical teams.'],
      title: 'Product Designer, Workflow Systems',
    },
    title: 'Missing employer stays empty while concrete vacancy fields remain grounded',
  },
] as const;
