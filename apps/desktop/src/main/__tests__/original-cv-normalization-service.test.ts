import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { OriginalCvNormalizationError } from '../original-cv-normalization-error.js';
import {
  createOriginalCvNormalizationService,
  type OriginalCvNormalizationResult,
} from '../original-cv-normalization-service.js';
import type { OriginalCvNormalizationWorker } from '../original-cv-normalization-worker.js';

const temporaryDirectories: string[] = [];

interface NormalizationExample {
  normalizedCv: {
    contact: {
      email: string;
      location: string;
      phone: string;
      professionalLink: string;
    };
    experience: {
      dateRange: string;
      employer: string;
      roleTitle: string;
      summary: string;
    }[];
    headline: string;
    summary: string;
  };
  title: string;
}

function createNormalizedOriginalCvExperienceEntry(
  overrides: Partial<NormalizationExample['normalizedCv']['experience'][number]> = {},
) {
  return {
    dateRange: '2022 — Present',
    employer: 'Analytical Engines Ltd',
    roleTitle: 'Principal Product Designer',
    summary: 'Led product design for AI-assisted desktop tooling.',
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      });
    }),
  );
});

test('writes a dedicated normalization run workspace with derived-field examples and removes it after the worker returns', async () => {
  const runWorkspaceRootPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-original-cv-normalization-service-'),
  );

  temporaryDirectories.push(runWorkspaceRootPath);

  const worker = {
    runNormalization: vi.fn(
      async ({ runDirectoryPath }: { runDirectoryPath: string; signal: AbortSignal }) => {
        const [examplesJson, taskJson, originalCvText] = await Promise.all([
          readFile(path.join(runDirectoryPath, 'input', 'examples.json'), 'utf8'),
          readFile(path.join(runDirectoryPath, 'input', 'task.json'), 'utf8'),
          readFile(path.join(runDirectoryPath, 'input', 'original-cv.txt'), 'utf8'),
        ]);
        const parsedTask = JSON.parse(taskJson) as unknown;
        const parsedExamples = JSON.parse(examplesJson) as unknown;

        expect(parsedTask).toEqual({
          constraints: {
            deriveFaithfulFieldsWhenNeeded: true,
            keepMissingFieldsEmpty: true,
            outputLanguage: 'British English',
            preserveHeaderContactExactly: true,
            preserveSourceMeaning: true,
            remainVacancyAware: false,
          },
          examplesPath: 'input/examples.json',
          originalCv: {
            extractedTextPath: 'input/original-cv.txt',
            fileType: 'pdf',
            originalFilename: 'ada-lovelace.pdf',
            pageCount: 2,
          },
          outputContract: {
            normalizedArtifactName: 'normalized.json',
            writingStyleArtifactName: 'writing-style-profile.json',
          },
        });
        expect(Array.isArray(parsedExamples)).toBe(true);

        const examples = parsedExamples as NormalizationExample[];
        const headingVariantExample = examples.find((example) => {
          return example.title === 'Heading variants and faithful summary recovery';
        });
        const fragmentedExperienceExample = examples.find((example) => {
          return (
            example.title === 'Fragmented experience regrouping and conservative skills recovery'
          );
        });

        expect(headingVariantExample?.normalizedCv.headline).toBe('Principal Product Designer');
        expect(headingVariantExample?.normalizedCv.contact.email).toBe('ada@lovelace.dev');
        expect(headingVariantExample?.normalizedCv.summary).toBe(
          'Design leader focused on complex workflow products for technical users.',
        );
        expect(fragmentedExperienceExample?.normalizedCv.experience).toContainEqual(
          createNormalizedOriginalCvExperienceEntry({
            dateRange: '',
            employer: 'Difference Engines Ltd',
            roleTitle: 'Senior Content Strategist',
            summary:
              'Built content systems and UX research practices for complex workflow products.',
          }),
        );
        expect(originalCvText).toBe('Ada Lovelace\nPrincipal Product Designer');

        return {
          normalizedCv: {
            contact: {
              email: 'ada@lovelace.dev',
              location: 'London, United Kingdom',
              phone: '+44 7700 900123',
              professionalLink: 'ada-lovelace.dev',
            },
            experience: [createNormalizedOriginalCvExperienceEntry()],
            fullName: 'Ada Lovelace',
            headline: 'Principal Product Designer',
            skills: ['Product strategy', 'UX research', 'Prototyping'],
            summary: 'Design leader focused on complex workflow products for technical users.',
          },
          writingStyle: {
            averageSentenceLength: 12,
            clicheDetections: [],
            firstPersonUsage: 'absent' as const,
            formality: 'formal' as const,
          },
        };
      },
    ),
  };
  const service = createOriginalCvNormalizationService({
    generateId: vi.fn(() => 'normalization-run-001'),
    runWorkspaceRootPath,
    worker,
  });

  await expect(
    service.normalizeOriginalCv({
      extractedText: 'Ada Lovelace\nPrincipal Product Designer',
      fileType: 'pdf',
      originalFilename: 'ada-lovelace.pdf',
      pageCount: 2,
    }),
  ).resolves.toEqual({
    normalizedCv: {
      contact: {
        email: 'ada@lovelace.dev',
        location: 'London, United Kingdom',
        phone: '+44 7700 900123',
        professionalLink: 'ada-lovelace.dev',
      },
      experience: [createNormalizedOriginalCvExperienceEntry()],
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
  });
  const firstCall = worker.runNormalization.mock.calls[0]?.[0];

  expect(firstCall?.runDirectoryPath).toBe(
    path.join(runWorkspaceRootPath, 'normalization-run-001'),
  );
  expect(firstCall?.signal).toBeInstanceOf(AbortSignal);
  await expect(readdir(runWorkspaceRootPath)).resolves.toEqual([]);
});

test('aborts a stalled normalization run after the dedicated timeout and removes the transient workspace', async () => {
  const runWorkspaceRootPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-original-cv-normalization-service-timeout-'),
  );

  temporaryDirectories.push(runWorkspaceRootPath);

  let didAbort = false;

  const worker: OriginalCvNormalizationWorker = {
    runNormalization: vi.fn(
      async ({ signal }: { runDirectoryPath: string; signal: AbortSignal }) => {
        return await new Promise<OriginalCvNormalizationResult>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              didAbort = true;
              reject(new Error('Original CV normalization cancelled.'));
            },
            {
              once: true,
            },
          );
        });
      },
    ),
  };
  const service = createOriginalCvNormalizationService({
    generateId: vi.fn(() => 'normalization-run-timeout'),
    runWorkspaceRootPath,
    timeoutMs: 5,
    worker,
  });

  await expect(
    service.normalizeOriginalCv({
      extractedText: 'Ada Lovelace\nPrincipal Product Designer',
      fileType: 'pdf',
      originalFilename: 'ada-lovelace.pdf',
      pageCount: 2,
    }),
  ).rejects.toEqual(
    new OriginalCvNormalizationError({
      code: 'timeout',
      message: 'Original CV normalization timed out.',
    }),
  );

  expect(worker.runNormalization).toHaveBeenCalledTimes(1);
  expect(didAbort).toBe(true);
  await expect(readdir(runWorkspaceRootPath)).resolves.toEqual([]);
});
