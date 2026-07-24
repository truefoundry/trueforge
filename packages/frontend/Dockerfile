# syntax=docker/dockerfile:1
#
# Multi-stage build for the private frontend app (not published to npm).
# Context must be the repository root (pnpm workspace).

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches patches
COPY packages/harness/package.json packages/harness/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/frontend/package.json packages/frontend/package.json
# Root postinstall builds utils gen scripts — copy the inputs it needs.
COPY packages/harness/scripts packages/harness/scripts
COPY packages/harness/src/core/sandbox/scripts packages/harness/src/core/sandbox/scripts
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter frontend...
COPY packages/frontend packages/frontend
RUN pnpm --filter frontend build

FROM caddy:2-alpine AS runner
COPY packages/frontend/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/packages/frontend/dist /usr/share/caddy
EXPOSE 80
