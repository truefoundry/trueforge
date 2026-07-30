# syntax=docker/dockerfile:1
#
# Multi-stage build for @truefoundry/server.
#
# The build context must be the repository root (this is a pnpm workspace and
# the server depends on the workspace package @truefoundry/utils). See the
# docker-compose.yml / build command at the repo root.
#
# Dependency install uses pnpm fetch (lockfile-only) then install --offline so
# the download layer stays cached when only package.json / scripts change.
# See https://pnpm.io/cli/fetch

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && pnpm config set store-dir /pnpm/store
WORKDIR /app

# ---------------------------------------------------------------------------
# builder: install all deps (incl. dev) and build utils + server.
# ---------------------------------------------------------------------------
FROM base AS builder
# Populate the store from the lockfile only (stable when manifests churn).
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

COPY package.json .npmrc tsconfig.base.json ./
COPY packages/harness/package.json packages/harness/package.json
COPY packages/server/package.json packages/server/package.json
# Workspace lockfile lists frontend; package.json must exist for install.
COPY packages/frontend/package.json packages/frontend/package.json
# The root postinstall hook runs build:gen in @truefoundry/utils, which needs
# the generator script and the sandbox Python sources it inlines.
COPY packages/harness/scripts packages/harness/scripts
COPY packages/harness/src/core/sandbox/scripts packages/harness/src/core/sandbox/scripts
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --offline --filter @truefoundry/server...
COPY packages/harness packages/harness
COPY packages/server packages/server
RUN pnpm --filter @truefoundry/utils build && pnpm --filter @truefoundry/server build

# ---------------------------------------------------------------------------
# prod-deps: resolve only production dependencies (no dev tooling).
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --prod

COPY package.json .npmrc ./
COPY packages/harness/package.json packages/harness/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/frontend/package.json packages/frontend/package.json
# Same as builder: the root postinstall hook needs the build:gen inputs.
COPY packages/harness/scripts packages/harness/scripts
COPY packages/harness/src/core/sandbox/scripts packages/harness/src/core/sandbox/scripts
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

WORKDIR /app/packages/server

# The YAML registry (models.yaml, mcp.yaml, skills.yaml) is read at runtime from
# ./registry and is provided via a volume mount rather than baked into the image.
RUN mkdir -p registry
VOLUME ["/app/packages/server/registry"]

EXPOSE 8790

CMD ["node", "dist/main.js"]
