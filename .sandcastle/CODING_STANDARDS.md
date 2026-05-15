# Coding Standards

Follow the repository rules in `AGENTS.md` first. In particular:

- Use `pnpm` and the package-owned scripts for the package you change.
- Use ES Modules only.
- Keep changes surgical and aligned with `ARCHITECTURE.md`.
- Use conventional commit messages.
- Do not close GitHub issues directly; use closing footers when a commit fully resolves a tracked issue.
- For app behavior changes, use TDD and verify behavior through public interfaces.
- Run `pnpm lint` and the relevant package type-check/test commands before committing.
