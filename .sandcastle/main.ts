import { execFileSync } from 'node:child_process';
import type { MountConfig } from '@ai-hero/sandcastle';
import * as sandcastle from '@ai-hero/sandcastle';
import { docker } from '@ai-hero/sandcastle/sandboxes/docker';

interface PlannedIssue {
  branch: string;
  number: number;
  title: string;
}

interface PlanOutput {
  issues: PlannedIssue[];
}

function isPlannedIssue(value: unknown): value is PlannedIssue {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.branch === 'string' &&
    typeof candidate.number === 'number' &&
    Number.isFinite(candidate.number) &&
    typeof candidate.title === 'string'
  );
}

function parsePlanOutput(planJson: string): PlanOutput {
  const parsedValue = JSON.parse(planJson) as unknown;

  if (parsedValue === null || typeof parsedValue !== 'object') {
    throw new TypeError('Invalid PlanOutput shape: top-level value must be an object.');
  }

  const candidate = parsedValue as {
    issues?: unknown;
  };

  if (!Array.isArray(candidate.issues)) {
    throw new TypeError("Invalid PlanOutput shape: missing or non-array 'issues'.");
  }

  if (!candidate.issues.every(isPlannedIssue)) {
    throw new TypeError('Invalid PlanOutput shape: each issue needs number, title, and branch.');
  }

  return {
    issues: candidate.issues,
  };
}

const createSemaphore = (maxParallel: number) => {
  let running = 0;
  const queue: (() => void)[] = [];

  const acquire = async () => {
    if (running < maxParallel) {
      running += 1;
    } else {
      await new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    }
  };

  const release = () => {
    running -= 1;

    const next = queue.shift();
    if (next !== undefined) {
      running += 1;
      next();
    }
  };

  return {
    acquire,
    release,
  };
};

const getLocalGitHubToken = () => {
  try {
    const token = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
};

const MAX_ITERATIONS = 10;
const MAX_PARALLEL = 4;
const agentProvider = sandcastle.codex('gpt-5.5', {
  effort: 'high',
});
const localGitHubToken = getLocalGitHubToken();
const sandboxMounts: MountConfig[] = [
  {
    hostPath: '~/.codex/auth.json',
    sandboxPath: '~/.codex/auth.json',
  },
  {
    hostPath: '~/.config/gh',
    readonly: true,
    sandboxPath: '~/.config/gh',
  },
];
const sandboxProvider = docker({
  env:
    localGitHubToken === null
      ? {}
      : {
          GH_TOKEN: localGitHubToken,
        },
  imageName: 'sandcastle:cv-maxxing',
  mounts: sandboxMounts,
});

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
  console.info(`\n=== Iteration ${String(iteration)}/${String(MAX_ITERATIONS)} ===\n`);

  const plan = await sandcastle.run({
    sandbox: sandboxProvider,
    name: 'Planner',
    agent: agentProvider,
    promptFile: './.sandcastle/plan-prompt.md',
  });

  const planMatch = /<plan>([\s\S]*?)<\/plan>/.exec(plan.stdout);
  if (planMatch === null) {
    throw new Error(`Orchestrator did not produce a <plan> tag.\n\n${plan.stdout}`);
  }

  const planJson = planMatch[1];
  if (planJson === undefined || planJson.trim() === '') {
    throw new Error(`Orchestrator produced an empty <plan> tag.\n\n${plan.stdout}`);
  }

  let parsedPlan: PlanOutput;
  try {
    parsedPlan = parsePlanOutput(planJson);
  } catch (error) {
    throw new Error(`Failed to parse plan JSON: ${String(error)}\n\nPlan content:\n${planJson}`);
  }

  const { issues } = parsedPlan;

  if (issues.length === 0) {
    console.info('No issues to work on. Exiting.');
    break;
  }

  console.info(`Planning complete. ${String(issues.length)} issue(s) to work in parallel:`);
  for (const issue of issues) {
    console.info(`  #${String(issue.number)}: ${issue.title} -> ${issue.branch}`);
  }

  const semaphore = createSemaphore(MAX_PARALLEL);

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      await semaphore.acquire();

      try {
        await using sandbox = await sandcastle.createSandbox({
          sandbox: sandboxProvider,
          branch: issue.branch,
          hooks: {
            host: {
              onSandboxReady: [
                {
                  command: 'pnpm install --frozen-lockfile',
                  timeoutMs: 300_000,
                },
              ],
            },
          },
        });

        const result = await sandbox.run({
          name: `Implementer #${String(issue.number)}`,
          agent: agentProvider,
          promptFile: './.sandcastle/implement-prompt.md',
          promptArgs: {
            BRANCH: issue.branch,
            ISSUE_NUMBER: String(issue.number),
            ISSUE_TITLE: issue.title,
          },
        });

        if (result.commits.length > 0) {
          await sandbox.run({
            name: `Reviewer #${String(issue.number)}`,
            agent: agentProvider,
            promptFile: './.sandcastle/review-prompt.md',
            promptArgs: {
              BRANCH: issue.branch,
              ISSUE_NUMBER: String(issue.number),
              ISSUE_TITLE: issue.title,
            },
          });
        }

        return {
          issue,
          result,
        };
      } finally {
        semaphore.release();
      }
    }),
  );

  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === 'rejected') {
      const issue = issues.at(index);
      const issueLabel =
        issue === undefined ? `issue at index ${String(index)}` : `#${String(issue.number)}`;

      console.error(`  x ${issueLabel} failed: ${String(outcome.reason)}`);
    }
  }

  const completedIssues = settled.flatMap((outcome) => {
    if (outcome.status !== 'fulfilled') {
      return [];
    }

    if (outcome.value.result.commits.length === 0) {
      return [];
    }

    return [outcome.value.issue];
  });

  const completedBranches = completedIssues.map((issue) => issue.branch);

  console.info(
    `\nExecution complete. ${String(completedBranches.length)} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.info(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    console.info('No commits produced. Nothing to merge.');
    continue;
  }

  await sandcastle.run({
    sandbox: sandboxProvider,
    name: 'Merger',
    maxIterations: 10,
    agent: agentProvider,
    promptFile: './.sandcastle/merge-prompt.md',
    promptArgs: {
      BRANCHES: completedBranches.map((branch) => `- ${branch}`).join('\n'),
      ISSUES: completedIssues
        .map((issue) => `- #${String(issue.number)}: ${issue.title}`)
        .join('\n'),
    },
  });

  console.info('\nBranches merged.');
}

console.info('\nAll done.');
