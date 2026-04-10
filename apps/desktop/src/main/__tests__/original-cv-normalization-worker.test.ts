import { expect, test } from 'vitest'

import { createOriginalCvNormalizationWorker } from '../original-cv-normalization-worker.js'

test('reports invalid fixture JSON with clear context for original CV normalization', async () => {
  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT: '{"invalid"',
    },
  })

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT produced invalid JSON/u)
})

test('rejects fixture output that does not match the normalization contract', async () => {
  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT: JSON.stringify({
        normalizedCv: {
          experience: [],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 12,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      }),
    },
  })

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/produced invalid normalization output/u)
})

test('returns parsed normalization results from fixture output', async () => {
  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT: JSON.stringify({
        normalizedCv: {
          experience: ['Principal Product Designer | Analytical Engines Ltd'],
          fullName: 'Ada Lovelace',
          headline: 'Principal Product Designer',
          skills: ['Product strategy', 'UX research', 'Prototyping'],
          summary: 'Design leader focused on complex workflow products for technical users.',
        },
        writingStyle: {
          averageSentenceLength: 12,
          clicheDetections: [],
          firstPersonUsage: 'absent',
          formality: 'formal',
        },
      }),
    },
  })

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual({
    normalizedCv: {
      experience: ['Principal Product Designer | Analytical Engines Ltd'],
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      skills: ['Product strategy', 'UX research', 'Prototyping'],
      summary: 'Design leader focused on complex workflow products for technical users.',
    },
    writingStyle: {
      averageSentenceLength: 12,
      clicheDetections: [],
      firstPersonUsage: 'absent',
      formality: 'formal',
    },
  })
})
