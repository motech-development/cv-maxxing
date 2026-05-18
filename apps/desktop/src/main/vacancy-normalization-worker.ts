import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { VacancyBrowserReadingActionRequest } from './vacancy-browser-actions.js';
import { VacancyNormalizationError } from './vacancy-normalization-error.js';
import type {
  NormalizedVacancy,
  VacancyNormalizationWorkerResult,
} from './vacancy-normalization-service.js';

type RawVacancyNormalizationWorkerResult =
  | {
      kind: 'no_job_content';
      normalizedVacancy?: null;
      readingActions?: null;
    }
  | {
      kind: 'page_interaction_requested';
      normalizedVacancy?: null;
      readingActions: VacancyBrowserReadingActionRequest[];
    }
  | {
      kind: 'success';
      normalizedVacancy: NormalizedVacancy;
      readingActions?: null;
    };

export interface VacancyNormalizationWorker {
  runNormalization: (input: {
    runDirectoryPath: string;
    signal: AbortSignal;
  }) => Promise<VacancyNormalizationWorkerResult>;
}

export interface VacancyNormalizationWorkerEnvironment {
  CV_MAXXING_AI_WORKER_CODEX_COMMAND?: string;
  CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_DELAY_MS?: string;
  CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_FAILURE?: string;
  CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT?: string;
}

const OUTPUT_SCHEMA = {
  additionalProperties: false,
  properties: {
    kind: {
      enum: ['no_job_content', 'page_interaction_requested', 'success'],
      type: 'string',
    },
    normalizedVacancy: {
      additionalProperties: false,
      properties: {
        bodyText: {
          type: 'string',
        },
        employer: {
          type: ['string', 'null'],
        },
        location: {
          type: ['string', 'null'],
        },
        requirements: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
        responsibilities: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
        title: {
          type: ['string', 'null'],
        },
      },
      required: ['bodyText', 'employer', 'location', 'requirements', 'responsibilities', 'title'],
      type: ['object', 'null'],
    },
    readingActions: {
      minItems: 1,
      items: {
        additionalProperties: false,
        properties: {
          kind: {
            enum: ['click', 'read'],
            type: 'string',
          },
          selector: {
            minLength: 1,
            pattern: String.raw`\S`,
            type: 'string',
          },
        },
        required: ['kind', 'selector'],
        type: 'object',
      },
      type: ['array', 'null'],
    },
  },
  required: ['kind', 'normalizedVacancy', 'readingActions'],
  type: 'object',
} as const;
const VACANCY_NORMALIZATION_MODEL = 'gpt-5.4';
const VACANCY_NORMALIZATION_REASONING_EFFORT = 'low';

export function createVacancyNormalizationWorker({
  environment = process.env,
}: {
  environment?: VacancyNormalizationWorkerEnvironment;
} = {}): VacancyNormalizationWorker {
  return {
    runNormalization: async ({ runDirectoryPath, signal }) => {
      const fixtureOutput = environment.CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT;

      if (fixtureOutput !== undefined && fixtureOutput.trim() !== '') {
        const delayMs = parseDelay(environment.CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_DELAY_MS);

        if (delayMs > 0) {
          await waitForDelay(delayMs, signal);
        }

        if (environment.CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_FAILURE) {
          throw new Error(environment.CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_FAILURE);
        }

        return parseNormalizationResultJson({
          context: 'CV_MAXXING_AI_WORKER_VACANCY_NORMALIZATION_OUTPUT',
          outputText: fixtureOutput,
        });
      }

      return await runCodexCliNormalization({
        command: environment.CV_MAXXING_AI_WORKER_CODEX_COMMAND ?? 'codex',
        runDirectoryPath,
        signal,
      });
    },
  };
}

async function runCodexCliNormalization({
  command,
  runDirectoryPath,
  signal,
}: {
  command: string;
  runDirectoryPath: string;
  signal: AbortSignal;
}): Promise<VacancyNormalizationWorkerResult> {
  const outputDirectoryPath = path.join(runDirectoryPath, 'output');
  const outputFilePath = path.join(outputDirectoryPath, 'result.json');
  const schemaFilePath = path.join(runDirectoryPath, 'output-schema.json');

  await mkdir(outputDirectoryPath, {
    recursive: true,
  });
  await writeFile(schemaFilePath, JSON.stringify(OUTPUT_SCHEMA), 'utf8');

  const prompt = [
    'Read input/task.json, input/examples.json, and the referenced vacancy artifacts.',
    'Return JSON only.',
    'Use British English.',
    'Preserve source meaning and page order.',
    'Ignore navigation chrome, cookie banners, account UI, and related-job content.',
    'Prefer the main vacancy body over summary snippets.',
    'Leave missing fields empty instead of guessing.',
    'If more same-page evidence is needed, request only safe reading actions with kind "click" or "read" and CSS selectors.',
    'Never request typing, form submission, file upload, application-start actions, account actions, or external navigation.',
    'For success and no_job_content results, set readingActions to null.',
    'If no real job content exists, return kind "no_job_content" with normalizedVacancy set to null.',
  ].join(' ');

  const stderrChunks: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      command,
      [
        'exec',
        '-m',
        VACANCY_NORMALIZATION_MODEL,
        '-c',
        `model_reasoning_effort="${VACANCY_NORMALIZATION_REASONING_EFFORT}"`,
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
        '--output-schema',
        schemaFilePath,
        '--output-last-message',
        outputFilePath,
        prompt,
      ],
      {
        cwd: runDirectoryPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(chunk.toString());
    });
    child.stdout.on('data', () => {
      return;
    });

    const abortHandler = () => {
      child.kill('SIGTERM');
      reject(new Error('Vacancy normalization cancelled.'));
    };

    signal.addEventListener('abort', abortHandler, {
      once: true,
    });

    child.on('error', (error) => {
      signal.removeEventListener('abort', abortHandler);
      reject(error);
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', abortHandler);

      if (signal.aborted) {
        reject(new Error('Vacancy normalization cancelled.'));

        return;
      }

      if (code !== 0) {
        reject(
          new Error(stderrChunks.join('').trim() || 'Codex CLI vacancy normalization failed.'),
        );

        return;
      }

      resolve();
    });
  });

  const outputText = await readFile(outputFilePath, 'utf8');

  return parseNormalizationResultJson({
    context: `Codex CLI output at ${outputFilePath}`,
    outputText,
  });
}

function parseNormalizationResultJson({
  context,
  outputText,
}: {
  context: string;
  outputText: string;
}): VacancyNormalizationWorkerResult {
  let parsedOutput: unknown;

  try {
    parsedOutput = JSON.parse(outputText) as unknown;
  } catch (error) {
    const preview = buildOutputPreview(outputText);
    const reason = error instanceof Error ? error.message : 'Unknown parse error.';

    throw new VacancyNormalizationError({
      code: 'invalid_normalization',
      message: `${context} produced invalid JSON: ${reason}. Preview: ${preview}`,
    });
  }

  if (!isRawVacancyNormalizationWorkerResult(parsedOutput)) {
    throw new VacancyNormalizationError({
      code: 'invalid_normalization',
      message: `${context} produced invalid normalization output. Preview: ${buildOutputPreview(
        outputText,
      )}`,
    });
  }

  return normalizeWorkerResult(parsedOutput);
}

function isRawVacancyNormalizationWorkerResult(
  value: unknown,
): value is RawVacancyNormalizationWorkerResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.kind === 'no_job_content') {
    return (
      (candidate.normalizedVacancy === undefined || candidate.normalizedVacancy === null) &&
      (candidate.readingActions === undefined || candidate.readingActions === null)
    );
  }

  if (candidate.kind === 'page_interaction_requested') {
    return (
      (candidate.normalizedVacancy === undefined || candidate.normalizedVacancy === null) &&
      isSafeReadingActionArray(candidate.readingActions)
    );
  }

  if (candidate.kind !== 'success') {
    return false;
  }

  return (
    isNormalizedVacancy(candidate.normalizedVacancy) &&
    (candidate.readingActions === undefined || candidate.readingActions === null)
  );
}

function normalizeWorkerResult(
  value: RawVacancyNormalizationWorkerResult,
): VacancyNormalizationWorkerResult {
  if (value.kind === 'no_job_content') {
    return {
      kind: 'no_job_content',
    };
  }

  if (value.kind === 'page_interaction_requested') {
    return {
      kind: 'page_interaction_requested',
      readingActions: value.readingActions,
    };
  }

  return {
    kind: 'success',
    normalizedVacancy: value.normalizedVacancy,
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      return typeof entry === 'string';
    })
  );
}

function isSafeReadingActionArray(value: unknown): value is VacancyBrowserReadingActionRequest[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return false;
      }

      const candidate = entry as Record<string, unknown>;

      return (
        (candidate.kind === 'click' || candidate.kind === 'read') &&
        typeof candidate.selector === 'string' &&
        candidate.selector.trim() !== ''
      );
    })
  );
}

function parseDelay(value: string | undefined): number {
  const parsedValue = Number.parseInt(value ?? '', 10);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 0;
  }

  return parsedValue;
}

function buildOutputPreview(outputText: string): string {
  const preview = outputText.length > 200 ? `${outputText.slice(0, 200)}...` : outputText;

  return JSON.stringify(preview);
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', abortHandler);
      resolve();
    }, delayMs);

    const abortHandler = () => {
      clearTimeout(timeoutId);
      reject(new Error('Vacancy normalization cancelled.'));
    };

    signal.addEventListener('abort', abortHandler, {
      once: true,
    });
  });
}

function isNormalizedVacancy(value: unknown): value is NormalizedVacancy {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.bodyText === 'string' &&
    isNullableString(candidate.employer) &&
    isNullableString(candidate.location) &&
    isStringArray(candidate.requirements) &&
    isStringArray(candidate.responsibilities) &&
    isNullableString(candidate.title)
  );
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}
