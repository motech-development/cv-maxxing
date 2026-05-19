# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge --squash <branch>`
2. If there are merge conflicts, resolve them by reading both sides and choosing the correct resolution
3. Stage the resolved merge changes
4. Run `pnpm lint` and the relevant package type-check/test commands
5. If verification fails, fix the issues before proceeding to the next branch
6. Make a conventional commit for that branch, with an issue closing footer only when the branch fully resolves the issue

Do not create merge commits during normal Sandcastle integration. Use merge-commit integration only when the user explicitly requests it.

After all branches are merged, do not create an additional summary commit unless you made extra fixes that were not captured in the per-branch merge commits.

Before finishing, run `git log --merges origin/main..HEAD`. If it prints any commits introduced by this integration, treat that as a failure and repair the history before outputting the completion promise.

# ISSUE REFERENCES

For each branch that was merged, include an issue closing footer only when the merged work fully resolves the issue.

Do not close issues directly through the GitHub API or CLI.

Here are all the issues:

{{ISSUES}}

Once you have merged everything you can, output <promise>COMPLETE</promise>.
