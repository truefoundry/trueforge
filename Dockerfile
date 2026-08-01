# syntax=docker/dockerfile:1
#
# Multi-stage build for @truefoundry/server, which also serves the UI: the only image the stack needs.
#
# Lives at the repository root because the build needs the whole pnpm workspace
# as its context: the server depends on the workspace package @truefoundry/utils.
#
# Dependency install uses pnpm fetch (lockfile-only) then install --offline so
# the download layer stays cached when only package.json / scripts change.
# See https://pnpm.io/cli/fetch

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && pnpm config set store-dir /pnpm/store
WORKDIR /app

# Native dependencies (for example better-sqlite3) compile in build stages.
FROM base AS build-base
RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# store: the pnpm store, from the lockfile only (stable when manifests churn).
# ---------------------------------------------------------------------------
FROM build-base AS store
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

# ---------------------------------------------------------------------------
# workspace: install inputs shared by every stage below — the manifests plus the
# sources the root postinstall hook (build:gen) inlines.
# ---------------------------------------------------------------------------
FROM store AS workspace
COPY package.json .npmrc tsconfig.base.json ./
COPY packages/harness/package.json packages/harness/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/harness/scripts packages/harness/scripts
COPY packages/harness/src/core/sandbox/scripts packages/harness/src/core/sandbox/scripts

# ---------------------------------------------------------------------------
# builder: install all deps (incl. dev) and build utils + server.
# ---------------------------------------------------------------------------
FROM workspace AS builder
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --offline --filter @truefoundry/server...
COPY packages/harness packages/harness
COPY packages/server packages/server
RUN pnpm --filter @truefoundry/utils build && pnpm --filter @truefoundry/server build

# ---------------------------------------------------------------------------
# frontend-builder: build the UI the server serves (parallel to builder above).
# ---------------------------------------------------------------------------
FROM workspace AS frontend-builder
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --offline --filter frontend...
COPY packages/frontend packages/frontend
RUN pnpm --filter frontend build

# ---------------------------------------------------------------------------
# prod-deps: production dependency tree (no dev tooling), resolved offline.
# ---------------------------------------------------------------------------
FROM workspace AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --offline --prod --filter @truefoundry/server...

# ---------------------------------------------------------------------------
# runner: minimal image with prod node_modules + built artifacts.
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production

# Production dependency tree (pnpm workspace symlinks preserved).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/harness/node_modules ./packages/harness/node_modules
COPY --from=prod-deps /app/packages/server/node_modules ./packages/server/node_modules

# Built workspace dependency (@truefoundry/utils).
COPY --from=builder /app/packages/harness/package.json ./packages/harness/package.json
COPY --from=builder /app/packages/harness/dist ./packages/harness/dist

# Built server.
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json
COPY --from=builder /app/packages/server/dist ./packages/server/dist

# The UI, at an absolute path so it resolves from any working directory.
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/frontend/dist
ENV FRONTEND_DIR=/app/packages/frontend/dist

WORKDIR /app/packages/server

# The YAML registry (models.yaml, mcp.yaml, skills.yaml) is read at runtime from
# ./registry and is provided via a volume mount rather than baked into the image.
RUN mkdir -p registry
VOLUME ["/app/packages/server/registry"]

EXPOSE 8790

CMD ["node", "dist/main.js"]
