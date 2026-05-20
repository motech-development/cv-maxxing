# TASK

Fix issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view`, with comments. If it has a parent PRD, pull that in too.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits and run the relevant verification commands.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

Follow `AGENTS.md` and `.sandcastle/CODING_STANDARDS.md`.

For app behavior changes, use red-green-refactor:

1. RED: write one failing behavior test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

# FEEDBACK LOOPS

Before committing, run `pnpm lint` and the relevant package type-check/test commands. For desktop app changes, this usually includes:

```sh
pnpm --filter @cv-maxxing/desktop typecheck
pnpm --filter @cv-maxxing/desktop test
```

# COMMIT

Make a conventional commit. The commit message must:

1. Summarize the task completed
2. Include key decisions made where useful
3. Include a closing footer such as `Closes #{{ISSUE_NUMBER}}` only when the work fully resolves the issue

Keep it concise.

# THE ISSUE

Do not close the issue directly through the GitHub API or CLI.

If the task is not complete, leave a comment on the GitHub issue with what was done.

Once complete, output <promise>COMPLETE</promise>. The orchestrator treats this marker
as the signal that the issue branch is ready for integration; commits without this
marker will not be merged automatically.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
