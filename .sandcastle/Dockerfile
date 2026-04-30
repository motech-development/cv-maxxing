FROM node:24-bookworm

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates curl git jq \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm

RUN npm install --global @openai/codex

RUN usermod --home /home/agent --move-home --login agent node
RUN mkdir -p /home/agent/.codex
RUN chmod 0777 /home/agent /home/agent/.codex

USER agent

WORKDIR /home/agent

# Sandcastle bind-mounts worker worktrees at /home/agent/workspace.
ENTRYPOINT ["sleep", "infinity"]
