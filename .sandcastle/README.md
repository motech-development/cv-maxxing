# Sandcastle PRD Workflow

This directory holds the repo-native Sandcastle workflow for PRD issue automation.
Phase 1 replaces the removed `tools/prd-orchestrator` package with a thin
Sandcastle entrypoint and prompt-driven agents.

## References

- Sandcastle: https://github.com/mattpocock/sandcastle
- Course Video Manager: https://github.com/mattpocock/course-video-manager
- Reference entrypoint: https://github.com/mattpocock/course-video-manager/blob/main/.sandcastle/main.ts
- Reference planner prompt: https://github.com/mattpocock/course-video-manager/blob/main/.sandcastle/plan-prompt.md
- Reference implementer prompt: https://github.com/mattpocock/course-video-manager/blob/main/.sandcastle/implement-prompt.md
- Reference reviewer prompt: https://github.com/mattpocock/course-video-manager/blob/main/.sandcastle/review-prompt.md
- Reference merger prompt: https://github.com/mattpocock/course-video-manager/blob/main/.sandcastle/merge-prompt.md
- Reference Dockerfile: https://github.com/mattpocock/course-video-manager/blob/main/.sandcastle/Dockerfile

## Setup

Use Node 24 and pnpm, matching the repository runtime and workspace tooling.

```sh
corepack enable pnpm
pnpm install
pnpm exec sandcastle docker build-image --image-name sandcastle:cv-maxxing
node .sandcastle/main.ts
```

Copy `.sandcastle/.env.example` to `.sandcastle/.env` locally and provide:

- `GITHUB_TOKEN` for GitHub CLI issue and draft PR operations.
- `OPENAI_API_KEY` for the Codex agent.
- `SANDCASTLE_CODEX_MODEL` when overriding the default `gpt-5.5` model.
- `SANDCASTLE_DOCKER_IMAGE` when using a non-default Docker image name.

Docker is the supported Phase 1 sandbox provider. The image uses Node 24,
pnpm via Corepack, GitHub CLI, and Codex.

## Phase 1 Shape

`.sandcastle/main.ts` stays intentionally small. It defines the bounded loop
shape used by the native workflow:

- `MAX_ITERATIONS = 10`
- `MAX_PARALLEL_CHILDREN = 4`
- planner, implementer, reviewer, and merger prompt file names
- Codex and Docker providers

The child slices add the prompt contracts and phase wiring. Host-side custom
state machines, local run-state databases, resume repair, child commit
rewriting, patch stacking, CI polling, and CodeRabbit comment repair are not
part of Phase 1.
