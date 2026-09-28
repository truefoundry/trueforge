# syntax=docker/dockerfile:1
#
# Production image: installs published @truefoundry/trueforge from npm.
# The app bits match the npm package exactly (not floating monorepo source).
#
# Required build-arg:
#   APP_VERSION — npm version to install, e.g. 0.1.0
#
# Example:
#   docker build --build-arg APP_VERSION=0.1.0 -t trueforge:0.1.0 .

# Debian 13. node:24-slim is still Debian 12, which has no fix for the critical
# perl-base and glibc CVEs (fixed in trixie perl 5.40.1-6+deb13u1 and
# glibc 2.41-12+deb13u4).
FROM node:24-trixie-slim AS runner
WORKDIR /app
# HOST=0.0.0.0 so Kubernetes Service/probe traffic reaches the process.
ENV NODE_ENV=production \
    STANDALONE=false \
    HOST=0.0.0.0

# Pick up security updates newer than the base image snapshot.
RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

ARG APP_VERSION
RUN test -n "$APP_VERSION" || (echo "APP_VERSION build-arg is required" >&2 && exit 1)

# Fail closed if the version is not on the registry (no workspace fallback).
RUN npm install --omit=dev "@truefoundry/trueforge@${APP_VERSION}" \
  && npm cache clean --force

RUN groupadd --gid 10001 trueforge \
  && useradd --uid 10001 --gid trueforge --shell /usr/sbin/nologin trueforge

EXPOSE 8790

# Same entry as the from-source image / `pnpm start` (launch-only; dist is in the package).
USER 10001:10001
CMD ["node", "node_modules/@truefoundry/trueforge/dist/main.js"]
