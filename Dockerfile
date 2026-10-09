# syntax=docker/dockerfile:1
#
# From-source multi-stage image for prod Helm, local smoke, and Railway.
# Lives at the repository root because the
# build needs the whole pnpm workspace as its context: the server depends on
# the workspace package @truefoundry/trueforge-core.
#
# Dependency install uses pnpm fetch (lockfile-only) then install --offline so
# the download layer stays cached when only package.json / scripts change.
# See https://pnpm.io/cli/fetch. BuildKit cache mounts are avoided so the same
# file builds on Railway Metal (which requires a hardcoded service id in mount ids).
#
# `pnpm fetch` also writes a full node_modules/.pnpm; remove it so --prod install
# does not inherit build tooling into the runtime image.
#
# Base images are build args so a local or contributor build stays on the public
# Docker Hub image. The release workflow overrides both with the hardened node
# images from the TrueFoundry private registry (builder: node:24-dev, runtime:
# node:24).

ARG BUILD_BASE_IMAGE=node:24-slim
ARG RUNTIME_BASE_IMAGE=node:24-slim

FROM ${BUILD_BASE_IMAGE} AS base
# The hardened bases default to uid 65532. Package install must run as root.
# node:24-slim is already root.
USER root
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && pnpm config set store-dir /pnpm/store
WORKDIR /app

# ---------------------------------------------------------------------------
# store: the pnpm store, from the lockfile only (stable when manifests churn).
# BuildKit cache mounts are omitted: Railway's Metal builder requires
# `id=s/<service-id>-…` (hardcoded per deploy), which cannot live in a shared
# OSS Dockerfile. Layer cache on this stage still hits when the lockfile is
# unchanged.
# ---------------------------------------------------------------------------
FROM base AS store
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
# Populate /pnpm/store only; drop the full virtual store fetch also writes.
RUN pnpm fetch && rm -rf node_modules

# ---------------------------------------------------------------------------
# workspace: install inputs shared by every stage below - the manifests plus the
# sources the root postinstall hook (build:gen) inlines.
# ---------------------------------------------------------------------------
FROM store AS workspace
COPY package.json .npmrc tsconfig.base.json ./
# Root scripts used by package build steps (rm-path.mjs, chmod-path.mjs).
COPY scripts scripts
COPY packages/trueforge-core/package.json packages/trueforge-core/package.json
COPY packages/trueforge/package.json packages/trueforge/package.json
COPY packages/trueforge-sdk/package.json packages/trueforge-sdk/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY packages/trueforge-ui/package.json packages/trueforge-ui/package.json
COPY packages/assistant-ui-runtime/package.json packages/assistant-ui-runtime/package.json
COPY packages/trueforge-core/scripts packages/trueforge-core/scripts
COPY packages/trueforge-core/src/core/sandbox/scripts packages/trueforge-core/src/core/sandbox/scripts

# ---------------------------------------------------------------------------
# builder: install all deps (incl. dev) and build trueforge-core + server.
# SDK dist is copied into the production runner; host-dev/typecheck resolve SDK
# from src/ via trueforge-dev. Build it here once for the image.
# ---------------------------------------------------------------------------
FROM workspace AS builder
RUN pnpm install --frozen-lockfile --offline --filter @truefoundry/trueforge...
COPY packages/trueforge-core packages/trueforge-core
COPY packages/trueforge-sdk packages/trueforge-sdk
RUN pnpm --filter @truefoundry/trueforge-sdk build
COPY packages/trueforge packages/trueforge
RUN pnpm --filter @truefoundry/trueforge-core build && pnpm --filter @truefoundry/trueforge build

# ---------------------------------------------------------------------------
# frontend-builder: build the UI the server serves (parallel to builder above).
# Bundlers read SDK src/ (trueforge-dev); the UI prebuild emits the declarations
# tsc needs, so this stage never compiles SDK JavaScript.
# ---------------------------------------------------------------------------
FROM workspace AS frontend-builder
RUN pnpm install --frozen-lockfile --offline --filter frontend...
COPY packages/trueforge-sdk packages/trueforge-sdk
COPY packages/assistant-ui-runtime packages/assistant-ui-runtime
COPY packages/trueforge-ui packages/trueforge-ui
RUN pnpm --filter @truefoundry/trueforge-ui build
COPY packages/frontend packages/frontend
RUN pnpm --filter frontend build

# ---------------------------------------------------------------------------
# prod-deps: production dependency tree (no dev tooling), resolved offline.
# ---------------------------------------------------------------------------
FROM workspace AS prod-deps
RUN pnpm install --frozen-lockfile --offline --prod --filter @truefoundry/trueforge...

# ---------------------------------------------------------------------------
# runner: minimal image with prod node_modules + built artifacts.
# Fresh FROM so a hardened runtime base does not keep the builder toolchain.
# The default matches the builder, so local builds stay on node:24-slim.
# ---------------------------------------------------------------------------
FROM ${RUNTIME_BASE_IMAGE} AS runner

USER root
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0

# Production dependency tree (pnpm workspace symlinks preserved).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/trueforge-core/node_modules ./packages/trueforge-core/node_modules
COPY --from=prod-deps /app/packages/trueforge/node_modules ./packages/trueforge/node_modules

# Built workspace dependencies (@truefoundry/trueforge-core + SDK).
COPY --from=builder /app/packages/trueforge-core/package.json ./packages/trueforge-core/package.json
COPY --from=builder /app/packages/trueforge-core/dist ./packages/trueforge-core/dist
COPY --from=builder /app/packages/trueforge-sdk/package.json ./packages/trueforge-sdk/package.json
COPY --from=builder /app/packages/trueforge-sdk/dist ./packages/trueforge-sdk/dist

# Built server (JS). UI is copied below from the parallel frontend stage into
# dist/_frontend - same path as the npm tarball / `pnpm build` copy step.
COPY --from=builder /app/packages/trueforge/package.json ./packages/trueforge/package.json
COPY --from=builder /app/packages/trueforge/dist ./packages/trueforge/dist
# Frontend builds in a parallel stage; place it at the same path as the npm tarball.
COPY --from=frontend-builder /app/packages/frontend/dist ./packages/trueforge/dist/_frontend

WORKDIR /app/packages/trueforge

# Chart pods run as uid 10001. Debian has groupadd; the hardened base has
# BusyBox addgroup. Fail loudly if a future base has neither, rather than on a
# bare "not found".
RUN if [ -x /usr/sbin/groupadd ]; then \
      groupadd --gid 10001 trueforge \
      && useradd --uid 10001 --gid trueforge trueforge; \
    elif command -v addgroup >/dev/null 2>&1 && command -v adduser >/dev/null 2>&1; then \
      addgroup -g 10001 trueforge \
      && adduser -D -H -u 10001 -G trueforge trueforge; \
    else \
      echo "base image has neither groupadd nor addgroup; cannot create uid 10001" >&2; \
      exit 1; \
    fi

EXPOSE 8790

USER 10001:10001
# The hardened base sets ENTRYPOINT to the node binary, the Docker Hub base to
# docker-entrypoint.sh. Clear it so CMD is the whole command on both, and a
# `command:` override stays a command rather than arguments to node.
ENTRYPOINT []
CMD ["node", "dist/main.js"]
