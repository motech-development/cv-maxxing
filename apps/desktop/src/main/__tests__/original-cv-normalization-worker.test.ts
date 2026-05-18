import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => {
  return {
    spawnMock: vi.fn(),
  };
});

vi.mock('node:child_process', () => {
  return {
    spawn: spawnMock,
  };
});

import { createOriginalCvNormalizationWorker } from '../original-cv-normalization-worker.js';

const temporaryDirectories: string[] = [];

function createNormalizedOriginalCvExperienceEntry(
  overrides: Partial<{
    dateRange: string;
    employer: string;
    roleTitle: string;
    summary: string;
  }> = {},
) {
  return {
    dateRange: '2022 — Present',
    employer: 'Analytical Engines Ltd',
    roleTitle: 'Principal Product Designer',
    summary: 'Led product design for AI-assisted desktop tooling.',
    ...overrides,
  };
}

class MockEventTarget extends EventTarget {
  on(eventName: string, listener: (detail: unknown) => void): this {
    this.addEventListener(eventName, (event) => {
      listener((event as CustomEvent<unknown>).detail);
    });

    return this;
  }

  emit(eventName: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

afterEach(async () => {
  spawnMock.mockReset();

  await Promise.all(
    temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, {
        force: true,
        recursive: true,
      });
    }),
  );
});

test('reports invalid fixture JSON with clear context for original CV normalization', async () => {
  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT: '{"invalid"',
    },
  });

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT produced invalid JSON/u);
});

test('rejects fixture output that does not match the normalization contract', async () => {
  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT: JSON.stringify({
        normalizedCv: {
          contact: {
            email: 'ada@lovelace.dev',
            location: 'London, United Kingdom',
            phone: '+44 7700 900123',
            professionalLink: 'ada-lovelace.dev',
          },
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
  });

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow(/produced invalid normalization output/u);
});

test('returns parsed normalization results from fixture output', async () => {
  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT: JSON.stringify({
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
      }),
    },
  });

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
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
});

test('fills missing AI contact fields with blank strings instead of rejecting normalization output', async () => {
  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_ORIGINAL_CV_NORMALIZATION_OUTPUT: JSON.stringify({
        normalizedCv: {
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
      }),
    },
  });

  await expect(
    worker.runNormalization({
      runDirectoryPath: '/tmp/unused',
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual({
    normalizedCv: {
      contact: {
        email: '',
        location: '',
        phone: '',
        professionalLink: '',
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
});

test('writes typed enum fields in the original-CV normalization output schema', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-original-cv-normalization-worker-schema-'),
  );

  temporaryDirectories.push(runDirectoryPath);

  let capturedSchema:
    | {
        properties?: {
          normalizedCv?: {
            required?: unknown;
          };
          writingStyle?: {
            properties?: {
              firstPersonUsage?: unknown;
              formality?: unknown;
            };
          };
        };
      }
    | undefined;

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = new MockEventTarget() as MockEventTarget & {
      stderr: MockEventTarget;
      stdout: MockEventTarget;
    };

    child.stderr = new MockEventTarget();
    child.stdout = new MockEventTarget();

    const schemaFlagIndex = args.indexOf('--output-schema');
    const outputFlagIndex = args.indexOf('--output-last-message');

    if (
      schemaFlagIndex === -1 ||
      outputFlagIndex === -1 ||
      schemaFlagIndex + 1 >= args.length ||
      outputFlagIndex + 1 >= args.length
    ) {
      throw new Error('Expected Codex CLI schema and output file path arguments.');
    }

    const schemaFilePath = args[schemaFlagIndex + 1];
    const outputFilePath = args[outputFlagIndex + 1];

    if (schemaFilePath === undefined || outputFilePath === undefined) {
      throw new Error('Expected Codex CLI schema and output file path arguments.');
    }

    void Promise.all([
      readFile(schemaFilePath, 'utf8').then((schemaText) => {
        capturedSchema = JSON.parse(schemaText) as typeof capturedSchema;
      }),
      writeFile(
        outputFilePath,
        JSON.stringify({
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
        }),
        'utf8',
      ),
    ]).then(
      () => {
        child.emit('close', 0);
      },
      (error: unknown) => {
        child.emit('error', error);
      },
    );

    return child;
  });

  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  });

  await expect(
    worker.runNormalization({
      runDirectoryPath,
      signal: new AbortController().signal,
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

  expect(capturedSchema?.properties?.writingStyle?.properties?.firstPersonUsage).toEqual({
    enum: ['absent', 'mixed', 'present'],
    type: 'string',
  });
  expect(capturedSchema?.properties?.writingStyle?.properties?.formality).toEqual({
    enum: ['conversational', 'direct', 'formal'],
    type: 'string',
  });
  expect(capturedSchema?.properties?.normalizedCv).toMatchObject({
    required: ['contact', 'experience', 'fullName', 'headline', 'skills', 'summary'],
  });
});

test('uses generic location instructions without assuming a specific CV layout', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-original-cv-normalization-worker-prompt-'),
  );

  temporaryDirectories.push(runDirectoryPath);

  let capturedPrompt: string | undefined;

  spawnMock.mockImplementation((_command: string, args: string[]) => {
    const child = new MockEventTarget() as MockEventTarget & {
      stderr: MockEventTarget;
      stdout: MockEventTarget;
    };

    child.stderr = new MockEventTarget();
    child.stdout = new MockEventTarget();

    const outputFlagIndex = args.indexOf('--output-last-message');

    if (outputFlagIndex === -1 || outputFlagIndex + 1 >= args.length) {
      throw new Error('Expected Codex CLI output file path argument.');
    }

    const outputFilePath = args[outputFlagIndex + 1];

    if (outputFilePath === undefined) {
      throw new Error('Expected Codex CLI output file path argument.');
    }

    capturedPrompt = args.at(-1);

    void writeFile(
      outputFilePath,
      JSON.stringify({
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
      }),
      'utf8',
    ).then(
      () => {
        child.emit('close', 0);
      },
      (error: unknown) => {
        child.emit('error', error);
      },
    );

    return child;
  });

  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  });

  await expect(
    worker.runNormalization({
      runDirectoryPath,
      signal: new AbortController().signal,
    }),
  ).resolves.toBeDefined();

  expect(capturedPrompt).toContain('Extract CV contact fields into normalizedCv.contact.');
  expect(capturedPrompt).toContain(
    'If the CV clearly provides a geographic location, return it in "location, country" format.',
  );
  expect(capturedPrompt).toContain(
    'If the CV provides a location but omits the country, infer the country and include it.',
  );
  expect(capturedPrompt).toContain(
    'Do not assume location appears in any specific section or layout position.',
  );
  expect(capturedPrompt).toContain(
    'If multiple professional links are present, prefer a personal portfolio, then LinkedIn, then GitHub.',
  );
  expect(capturedPrompt).not.toContain('Extract header contact fields into normalizedCv.contact.');
});

test('kills the Codex CLI subprocess when normalization is aborted', async () => {
  const runDirectoryPath = await mkdtemp(
    path.join(tmpdir(), 'cv-maxxing-original-cv-normalization-worker-abort-'),
  );

  temporaryDirectories.push(runDirectoryPath);

  const childProcesses: (MockEventTarget & {
    kill: ReturnType<typeof vi.fn>;
    stderr: MockEventTarget;
    stdout: MockEventTarget;
  })[] = [];

  spawnMock.mockImplementation(() => {
    const child = new MockEventTarget() as MockEventTarget & {
      kill: ReturnType<typeof vi.fn>;
      stderr: MockEventTarget;
      stdout: MockEventTarget;
    };

    child.kill = vi.fn(() => {
      child.emit('close', null);
    });
    child.stderr = new MockEventTarget();
    child.stdout = new MockEventTarget();
    childProcesses.push(child);

    return child;
  });

  const worker = createOriginalCvNormalizationWorker({
    environment: {
      CV_MAXXING_AI_WORKER_CODEX_COMMAND: 'codex',
    },
  });
  const abortController = new AbortController();
  const runPromise = worker.runNormalization({
    runDirectoryPath,
    signal: abortController.signal,
  });

  await vi.waitFor(() => {
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  expect(spawnMock).toHaveBeenCalledWith(
    'codex',
    expect.arrayContaining([
      'exec',
      '-m',
      'gpt-5.4',
      '-c',
      'model_reasoning_effort="low"',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
    ]),
    expect.objectContaining({
      cwd: runDirectoryPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );

  abortController.abort();

  await expect(runPromise).rejects.toThrow('Original CV normalization cancelled.');
  expect(childProcesses).toHaveLength(1);
  expect(childProcesses[0]?.kill).toHaveBeenCalledWith('SIGTERM');
});
