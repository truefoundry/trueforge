#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

render() {
  helm template domain-test "$ROOT" --namespace chart-test \
    --show-only templates/deployment.yaml --show-only templates/controller-deployment.yaml \
    "$@" > "$TMP/rendered.yaml"
}

contains() {
  grep -Fq -- "$1" "$TMP/rendered.yaml" || {
    echo "Missing expected value: $1" >&2
    exit 1
  }
}

check_domain() {
  local domain="$1"
  contains "http://domain-test-trueforge-server.chart-test.svc.$domain:8790"
  contains "domain-test-postgresql.chart-test.svc.$domain"
  contains "redis://domain-test-trueforge-redis-master.chart-test.svc.$domain:6379"
}

render
check_domain cluster.local
render --set global.clusterDomain=example.internal
check_domain example.internal
if grep -Fq 'svc.cluster.local' "$TMP/rendered.yaml"; then
  echo 'Custom-domain app endpoints still contain svc.cluster.local' >&2
  exit 1
fi
render --set-string global.clusterDomain=
check_domain cluster.local
render --set global.clusterDomain=null
check_domain cluster.local

render --set global.clusterDomain=example.internal \
  --set truefoundry.devSandboxServerEnabled=true \
  --set tfy-sandbox-server.fullnameOverride=custom-sandbox \
  --set global.namespaceOverride=sandbox-ns
check_domain example.internal
contains 'http://custom-sandbox.sandbox-ns.svc.example.internal:8080'
contains 'ws://custom-sandbox.sandbox-ns.svc.example.internal:4444'

render --set global.clusterDomain=example.internal --set mtls.enabled=true \
  --set mtls.secretName=test-mtls \
  --set postgresql.namespaceOverride=database-ns --set redis.namespaceOverride=redis-ns \
  --set redis.fullnameOverride=custom-redis
contains 'https://domain-test-trueforge-server.chart-test.svc.example.internal:8790'
contains 'domain-test-postgresql.database-ns.svc.example.internal'
contains 'redis://custom-redis-master.redis-ns.svc.example.internal:6379'

render --set global.clusterDomain=example.internal \
  --set postgresql.enabled=false --set externalPostgres.host=db.external.test \
  --set externalPostgres.password=test-password \
  --set redis.enabled=false --set externalRedis.enabled=true \
  --set externalRedis.url=redis://redis.external.test:6379 \
  --set controller.serverUrl=https://server.external.test \
  --set truefoundry.devSandboxServerEnabled=true \
  --set env.TRUEFOUNDRY_SANDBOX_SERVER_URL=https://sandbox.external.test
contains 'value: db.external.test'
contains 'value: redis://redis.external.test:6379'
contains 'value: https://server.external.test'
contains 'value: https://sandbox.external.test'

echo 'ok: TrueForge cluster domain, sandbox dependency, TLS and endpoint overrides'
