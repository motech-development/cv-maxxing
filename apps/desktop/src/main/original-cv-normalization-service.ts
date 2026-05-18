import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OriginalCvFileType, OriginalCvWritingStyle } from '../shared/original-cv.js';
import { OriginalCvNormalizationError } from './original-cv-normalization-error.js';
import type { OriginalCvNormalizationWorker } from './original-cv-normalization-worker.js';

export interface NormalizedOriginalCvContact {
  email: string;
  location: string;
  phone: string;
  professionalLink: string;
}

export interface NormalizedOriginalCvExperienceEntry {
  dateRange: string;
  employer: string;
  roleTitle: string;
  summary: string;
}

export interface NormalizedOriginalCv {
  contact: NormalizedOriginalCvContact;
  experience: NormalizedOriginalCvExperienceEntry[];
  fullName: string;
  headline: string;
  skills: string[];
  summary: string;
}

export interface OriginalCvNormalizationInput {
  extractedText: string;
  fileType: OriginalCvFileType;
  originalFilename: string;
  pageCount: number;
}

export interface OriginalCvNormalizationResult {
  normalizedCv: NormalizedOriginalCv;
  writingStyle: OriginalCvWritingStyle;
}

export interface OriginalCvNormalizationService {
  normalizeOriginalCv: (
    input: OriginalCvNormalizationInput,
  ) => Promise<OriginalCvNormalizationResult>;
}

interface OriginalCvNormalizationServiceInput {
  generateId?: () => string;
  runWorkspaceRootPath: string;
  timeoutMs?: number;
  worker?: OriginalCvNormalizationWorker;
}

const ORIGINAL_CV_NORMALIZATION_EXAMPLES = [
  {
    normalizedCv: {
      contact: {
        email: 'ada@lovelace.dev',
        location: 'London, United Kingdom',
        phone: '+44 7700 900123',
        professionalLink: 'ada-lovelace.dev',
      },
      experience: [
        {
          dateRange: '2022 — Present',
          employer: 'Analytical Engines Ltd',
          roleTitle: 'Principal Product Designer',
          summary:
            'Led product design for AI-assisted desktop tooling across import and export flows.',
        },
      ],
      fullName: 'Ada Lovelace',
      headline: 'Principal Product Designer',
      skills: ['Workflow design', 'UX research', 'Content systems'],
      summary: 'Design leader focused on complex workflow products for technical users.',
    },
    title: 'Heading variants and faithful summary recovery',
  },
  {
    normalizedCv: {
      contact: {
        email: 'ada@lovelace.dev',
        location: 'London, United Kingdom',
        phone: '+44 7700 900123',
        professionalLink: 'linkedin.com/in/ada-lovelace',
      },
      experience: [
        {
          dateRange: '',
          employer: 'Difference Engines Ltd',
          roleTitle: 'Senior Content Strategist',
          summary: 'Built content systems and UX research practices for complex workflow products.',
        },
      ],
      fullName: 'Ada Lovelace',
      headline: 'Senior Content Strategist',
      skills: ['Content systems', 'Editorial strategy', 'UX research'],
      summary: 'Content strategist shaping truthful workflow tools for technical job seekers.',
    },
    title: 'Fragmented experience regrouping and conservative skills recovery',
  },
] as const;

const missingOriginalCvNormalizationWorker: OriginalCvNormalizationWorker = {
  runNormalization: () => {
    return Promise.reject(new Error('No original-CV normalization worker is configured.'));
  },
};

const DEFAULT_ORIGINAL_CV_NORMALIZATION_TIMEOUT_MS = 120_000;
const ORIGINAL_CV_NORMALIZATION_TIMEOUT_REASON = Symbol('original-cv-normalization-timeout');

export function createOriginalCvNormalizationService({
  generateId = randomUUID,
  runWorkspaceRootPath,
  timeoutMs = DEFAULT_ORIGINAL_CV_NORMALIZATION_TIMEOUT_MS,
  worker = missingOriginalCvNormalizationWorker,
}: OriginalCvNormalizationServiceInput): OriginalCvNormalizationService {
  const resolvedTimeoutMs = resolveTimeoutMs(timeoutMs);

  return {
    normalizeOriginalCv: async (input): Promise<OriginalCvNormalizationResult> => {
      const runDirectoryPath = path.join(runWorkspaceRootPath, generateId());
      const abortController = new AbortController();

      await writeRunWorkspaceInput({
        input,
        runDirectoryPath,
      });

      const timeoutId = setTimeout(() => {
        abortController.abort(ORIGINAL_CV_NORMALIZATION_TIMEOUT_REASON);
      }, resolvedTimeoutMs);

      try {
        return await worker.runNormalization({
          runDirectoryPath,
          signal: abortController.signal,
        });
      } catch (error) {
        if (abortController.signal.reason === ORIGINAL_CV_NORMALIZATION_TIMEOUT_REASON) {
          throw new OriginalCvNormalizationError({
            code: 'timeout',
            message: 'Original CV normalization timed out.',
          });
        }

        throw error;
      } finally {
        clearTimeout(timeoutId);
        await rm(runDirectoryPath, {
          force: true,
          recursive: true,
        });
      }
    },
  };
}

async function writeRunWorkspaceInput({
  input,
  runDirectoryPath,
}: {
  input: OriginalCvNormalizationInput;
  runDirectoryPath: string;
}): Promise<void> {
  const inputDirectoryPath = path.join(runDirectoryPath, 'input');
  const taskJson = JSON.stringify({
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
      fileType: input.fileType,
      originalFilename: input.originalFilename,
      pageCount: input.pageCount,
    },
    outputContract: {
      normalizedArtifactName: 'normalized.json',
      writingStyleArtifactName: 'writing-style-profile.json',
    },
  });

  await mkdir(inputDirectoryPath, {
    recursive: true,
  });
  await Promise.all([
    writeFile(
      path.join(inputDirectoryPath, 'examples.json'),
      JSON.stringify(ORIGINAL_CV_NORMALIZATION_EXAMPLES),
      'utf8',
    ),
    writeFile(path.join(inputDirectoryPath, 'original-cv.txt'), input.extractedText, 'utf8'),
    writeFile(path.join(inputDirectoryPath, 'task.json'), taskJson, 'utf8'),
  ]);
}

function resolveTimeoutMs(timeoutMs: number) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_ORIGINAL_CV_NORMALIZATION_TIMEOUT_MS;
  }

  return Math.trunc(timeoutMs);
}
