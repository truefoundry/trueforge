# syntax=docker/dockerfile:1
#
# Multi-stage build for @truefoundry/utils, which also serves the UI: the only image the stack needs.
#
# Lives at the repository root because the build needs the whole pnpm workspace
# as its context: the server depends on the workspace package @truefoundry/utils-core.
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
RUN apt update \
  && apt install -y --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# store: the pnpm store, from the lockfile only (stable when manifests churn).
# ---------------------------------------------------------------------------
FROM build-base AS store
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
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
COPY packages/trueforge-ui-sdk/package.json packages/trueforge-ui-sdk/package.json
COPY packages/harness/scripts packages/harness/scripts
COPY packages/harness/src/core/sandbox/scripts packages/harness/src/core/sandbox/scripts

# ---------------------------------------------------------------------------
# builder: install all deps (incl. dev) and build utils-core + server.
# ---------------------------------------------------------------------------
FROM workspace AS builder
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --offline --filter @truefoundry/utils...
COPY packages/harness packages/harness
COPY packages/server packages/server
RUN pnpm --filter @truefoundry/utils-core build && pnpm --filter @truefoundry/utils build

# ---------------------------------------------------------------------------
# frontend-builder: build the UI the server serves (parallel to builder above).
# ---------------------------------------------------------------------------
FROM workspace AS frontend-builder
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --offline --filter frontend...
COPY packages/trueforge-ui-sdk packages/trueforge-ui-sdk
RUN pnpm --filter @truefoundry/trueforge-ui build
COPY packages/frontend packages/frontend
# trueforge is linked from packages/sdk (outside the pnpm workspace).
COPY packages/sdk/package.json packages/sdk/pnpm-lock.yaml packages/sdk/pnpm-workspace.yaml packages/sdk/
COPY packages/sdk/scripts packages/sdk/scripts
COPY packages/sdk/src packages/sdk/src
COPY packages/sdk/tsconfig*.json packages/sdk/
RUN --mount=type=cache,id=pnpm-sdk,target=/pnpm/store \
  cd packages/sdk && pnpm install --frozen-lockfile
RUN pnpm --filter frontend build

# ---------------------------------------------------------------------------
# prod-deps: production dependency tree (no dev tooling), resolved offline.
# ---------------------------------------------------------------------------
FROM workspace AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --offline --prod --filter @truefoundry/utils...

# ---------------------------------------------------------------------------
# runner: minimal image with prod node_modules + built artifacts.
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production

# Production dependency tree (pnpm workspace symlinks preserved).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/harness/node_modules ./packages/harness/node_modules
COPY --from=prod-deps /app/packages/server/node_modules ./packages/server/node_modules

# Built workspace dependency (@truefoundry/utils-core).
COPY --from=builder /app/packages/harness/package.json ./packages/harness/package.json
COPY --from=builder /app/packages/harness/dist ./packages/harness/dist

# Built server (JS). UI is copied below from the parallel frontend stage into
# dist/_frontend — same path as the npm tarball / `pnpm build` copy step.
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json
COPY --from=builder /app/packages/server/dist ./packages/server/dist
# Frontend builds in a parallel stage; place it at the same path as the npm tarball.
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/server/dist/_frontend

WORKDIR /app/packages/server

EXPOSE 8790

# Launch-only (matches root `pnpm start` / `standalone:start`). Image already contains dist.
CMD ["node", "dist/main.js"]
