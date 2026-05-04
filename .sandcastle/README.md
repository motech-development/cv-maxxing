# Sandcastle PRD Workflow

This directory holds the repo-native Sandcastle workflow for PRD issue automation
using a thin Sandcastle entrypoint and prompt-driven agents.

## Setup

Use Node 24 and pnpm, matching `.nvmrc` and the repository workspace tooling.
The workflow assumes these tools are available on the host or inside the Sandcastle
container:

- Docker, for the supported Sandcastle sandbox provider.
- GitHub CLI, authenticated with access to `motech-development/cv-maxxing`.
- Codex, logged in locally with the subscription account you want Sandcastle to
  reuse.
- pnpm via Corepack, using the repository-pinned package manager version.
- Git credentials that can create local branches and, when running for real,
  push the parent PRD branch.

Build the local Sandcastle image and run the controlled wiring check:

```sh
corepack enable pnpm
pnpm install
pnpm exec sandcastle docker build-image --image-name sandcastle:cv-maxxing
pnpm sandcastle:dry-run
```

Run the workflow entrypoint without side effects:

```sh
pnpm sandcastle
```

Before running the real workflow, log in to Codex locally:

```sh
codex login
```

The Docker sandbox reuses your Codex subscription login by mounting only
`~/.codex/auth.json`, plus `~/.codex/config.toml` when present, into a
sandbox-local `CODEX_HOME`. It does not require an OpenAI API key and does not
mount your whole `~/.codex` directory.

Copy `.sandcastle/.env.example` to `.sandcastle/.env` locally and provide:

- `GITHUB_TOKEN` for GitHub CLI issue and draft PR operations.
- `SANDCASTLE_CODEX_MODEL` when overriding the default `gpt-5.5` model.
- `SANDCASTLE_DOCKER_IMAGE` when using a non-default Docker image name.
- `SANDCASTLE_HOST_CODEX_HOME` only when your host Codex login is not in
  `~/.codex`.

Docker is the supported sandbox provider. The image uses Node 24,
pnpm via Corepack, GitHub CLI, and Codex.

For GitHub CLI, either run `gh auth login` before invoking the workflow or
provide a token through the environment used by the container.

## Workflow Shape

`.sandcastle/main.ts` stays intentionally small. It defines the bounded loop
shape used by the native workflow:

- `MAX_ITERATIONS = 10`
- `MAX_PARALLEL_CHILDREN = 4`
- planner, implementer, reviewer, and merger prompt file names
- Codex and Docker providers

The workflow uses GitHub issues, child branches, normal git merges, and one
draft pull request as durable workflow state. It deliberately excludes:

- CodeRabbit comment repair.
- Ready-for-review marking.
- CI polling.
- Custom resume or recovery machinery.
- History rewriting, including child commit rewriting.

The controlled dry run (`pnpm sandcastle:dry-run`) demonstrates the
planner, implementer/reviewer, merger, and draft PR wiring with injected no-op
executors. It does not inspect live GitHub issues, start Codex, create branches,
merge branches, or create a real pull request.
