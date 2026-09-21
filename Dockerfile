# syntax=docker/dockerfile:1
#
# Production image: installs published @truefoundry/trueforge from npm.
# The app bits match the npm package exactly (not floating monorepo source).
#
# Required build-arg:
#   APP_VERSION — npm version to install, e.g. 0.1.0
#
# Optional build-args (same family for native addons; *-dev when runtime has no shell):
#   BUILDER_IMAGE — shell + npm for install (default node:24-alpine)
#   BASE_IMAGE    — runtime image; may be shell-less (default node:24-alpine)
#
# Examples:
#   docker build --build-arg APP_VERSION=0.1.0 -t trueforge:0.1.0 .
#   docker build --build-arg APP_VERSION=0.1.0 \
#     --build-arg BUILDER_IMAGE=dhi.io/node:24-alpine3.23-dev \
#     --build-arg BASE_IMAGE=dhi.io/node:24-alpine3.23 \
#     -t trueforge:0.1.0 .

ARG BUILDER_IMAGE=node:24-alpine
ARG BASE_IMAGE=node:24-alpine

FROM $BUILDER_IMAGE AS builder
WORKDIR /app
ENV NODE_ENV=production

ARG APP_VERSION
RUN test -n "$APP_VERSION" || (echo "APP_VERSION build-arg is required" >&2 && exit 1)

# Fail closed if the version is not on the registry (no workspace fallback).
RUN npm install --omit=dev "@truefoundry/trueforge@${APP_VERSION}" \
  && npm cache clean --force

FROM $BASE_IMAGE AS runner
WORKDIR /app
# HOST=0.0.0.0 so Kubernetes Service/probe traffic reaches the process.
ENV NODE_ENV=production \
    STANDALONE=false \
    HOST=0.0.0.0

# Numeric uid/gid only — no useradd/groupadd (distroless / DHI runtime have neither).
COPY --from=builder --chown=10001:10001 /app /app

EXPOSE 8790

# Same entry as the from-source image / `pnpm start` (launch-only; dist is in the package).
USER 10001:10001
ENTRYPOINT ["node"]
CMD ["node_modules/@truefoundry/trueforge/dist/main.js"]
