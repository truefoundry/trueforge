# trueforge Helm chart

Deploys the TrueForge server, a single container image that serves both the API
and the UI. **Production** images install `@truefoundry/trueforge` from npm
(repository-root [`Dockerfile`](../../Dockerfile) with `APP_VERSION`).
**Local smoke / from-source** builds use [`Dockerfile.dev`](../../Dockerfile.dev)
(see [`docker-compose.yml`](../../docker-compose.yml)).

The chart always runs the server in **distributed** mode (`STANDALONE=false`) against
Postgres and Redis.

Chart `version` / `appVersion` / `image.tag` are maintained on `main` (chart-release
bot PR or human). Publishing is gated by git tag `charts/trueforge@<version>`.
See [`RELEASING.md`](../../RELEASING.md).

## Dev defaults (read before exposing)

A bare `helm install` is intentionally easy for local / private-cluster trials.
Those defaults are **not** production-safe:

| Default | Risk if the Service / Ingress is reachable |
| --- | --- |
| `configs.oidc.enabled: false` | No login; every caller is the shared local admin (`trueforge-default`) |
| `postgresql.auth.password: trueforge` | Well-known Postgres password (unless you set `existingSecret` / a strong password) |
| `redis.auth.enabled: false` | Unauthenticated Redis on the cluster network |

Before exposing TrueForge beyond a trusted network: enable OIDC, change or
Secret-back the Postgres password, and prefer external passworded Redis (or
keep Redis ClusterIP-only and NetworkPolicy-restricted). See
[Production checklist](#production-checklist) and the
[Setup Login](https://github.com/truefoundry/trueforge/blob/main/docs/authentication/overview.mdx)
docs.

## Dependencies

Postgres and Redis ship as **bundled** dependencies (the Bitnami `postgresql`
and `redis` charts, pulled from the public Bitnami OCI archive and pinned by
`Chart.lock`). They are enabled by default, so a basic install needs **no
required values**. The chart wires the server's `POSTGRES_*` and `REDIS_URL`
env to the bundled services automatically.

The Bitnami **charts** are still public, but the **container images** they
reference were moved to `docker.io/bitnamilegacy`, so `values.yaml` overrides the
subchart images to pinned tags mirrored to the TrueFoundry JFrog registry
(`tfy.jfrog.io/tfy-mirror/bitnamilegacy/...`). This trips Bitnami's registry
guardrail, so `global.security.allowInsecureImages: true` is set for the
subcharts to render.

Disable either dependency to point at an external service instead (see below).

## Install

```bash
helm install trueforge oci://tfy.jfrog.io/tfy-helm/trueforge \
  --version <x.y.z>
```

Optional: set the public origin once you expose the service (needed for MCP OAuth
and OIDC callbacks):

```bash
helm upgrade --install trueforge oci://tfy.jfrog.io/tfy-helm/trueforge \
  --version <x.y.z> \
  --set server.publicBaseUrl=https://trueforge.example.com
```

## Postgres

Bundled by default (`postgresql.enabled=true`). The chart ships a **dev**
password (`trueforge`). Change `postgresql.auth.password` or set
Bitnami's `postgresql.auth.existingSecret` before any shared / public deploy.
Also set `postgresql.auth.username` and `postgresql.auth.database` as needed;
the server connects to the bundled instance automatically.

To use an **external** Postgres, set `postgresql.enabled=false` and provide
`externalPostgres.host` (+ `port`, `database`, `user`). Set
`externalPostgres.password` as a string (inlined as env `value`) or as
`valueFrom.secretKeyRef` (preferred in production — you create the Secret):

```yaml
postgresql:
  enabled: false
externalPostgres:
  host: postgres.databases.svc
  password:
    valueFrom:
      secretKeyRef:
        name: my-postgres-secret
        key: password
```

## Redis

The server always runs peered (`STANDALONE=false`), so Redis is always required.
Bundled by default (`redis.enabled=true`, **auth disabled** — fine only when
Redis stays unreachable outside the cluster trust boundary). To use an
**external** Redis, set `redis.enabled=false` and provide `externalRedis.url`
as a string or `valueFrom.secretKeyRef`:

```yaml
redis:
  enabled: false
externalRedis:
  url:
    valueFrom:
      secretKeyRef:
        name: my-redis-secret
        key: redis-url
```

For passworded Redis, prefer an external instance and load `REDIS_URL` via
`valueFrom`.

## OIDC

Configure IdP login under `configs.oidc`. When `enabled` is false (the default),
no `OIDC_*` env is set and the server uses a **fixed local admin** identity —
anyone who can reach the API/UI has full admin access. Enable OIDC for any
shared or public deployment. When enabled, set string `issuerUrl` and
`clientId`, and `clientSecret` as a string or `valueFrom.secretKeyRef`
(prefer valueFrom in production).

Also set `server.publicBaseUrl` to the public origin and register
`{publicBaseUrl}/api/v1/auth/callback` at your IdP.

```yaml
server:
  publicBaseUrl: https://trueforge.example.com
configs:
  oidc:
    enabled: true
    issuerUrl: https://idp.example.com/oauth2/default
    clientId: trueforge
    clientSecret:
      valueFrom:
        secretKeyRef:
          name: trueforge-oidc
          key: client-secret
    # optional claim overrides (defaults shown):
    # userReferenceClaim: sub
    # userDisplayNameClaim: name
    # userRoleClaim: groups
    # adminRoleValue: admin
    # scopes: "openid,profile,email,groups"
    # Optional email allowlist (exact + * globs). Empty = unrestricted.
    # allowedEmails: "alice@acme.com,*@partner.com"
```

## Using Secrets

Prefer Kubernetes Secrets over literals in values files for production. This
chart does **not** create Secrets for chart-owned fields — supply
`valueFrom.secretKeyRef` (or create Secrets yourself and point at them).

Fields that accept string | `valueFrom.secretKeyRef`:
`externalPostgres.password`, `externalRedis.url`, `configs.oidc.clientSecret`.
`configs.oidc.issuerUrl` and `clientId` are plain strings only.

**Bundled Postgres password** still uses Bitnami's API (`postgresql.auth.existingSecret`,
key `password`):

```yaml
postgresql:
  auth:
    existingSecret: my-postgres-secret
    # leave password empty / unused when existingSecret is set
```

## Extra objects

Deploy arbitrary manifests alongside the server (for example an Istio
`VirtualService`, a `Gateway`, an Ingress, or a NetworkPolicy) via
`extraObjects`. Each entry is a full object, rendered through `tpl` so Helm
templating and chart helpers resolve:

```yaml
extraObjects:
  - apiVersion: networking.istio.io/v1
    kind: VirtualService
    metadata:
      name: '{{ include "trueforge.fullname" . }}'
    spec:
      hosts:
        - trueforge.example.com
      gateways:
        - istio-system/public-gateway
      http:
        - route:
            - destination:
                host: '{{ include "trueforge.fullname" . }}'
                port:
                  number: '{{ .Values.service.port }}'
```

## Common values

| Value                 | Default                             | Description                           |
| --------------------- | ----------------------------------- | ------------------------------------- |
| `server.replicaCount` | `1`                                 | Number of server replicas.            |
| `image.repository`    | `tfy.jfrog.io/tfy-images/trueforge` | Image repository.                     |
| `image.tag`           | chart `appVersion`                  | Image tag; stamped on release.        |
| `server.publicBaseUrl`| `""`                                | Public origin for OAuth/OIDC callbacks (required for MCP OAuth / OIDC). |
| `configs.oidc.enabled`| `false`                             | Inject `OIDC_*` env for IdP login.    |
| `postgresql.enabled`  | `true`                              | Bundle the Bitnami Postgres subchart. |
| `redis.enabled`       | `true`                              | Bundle the Bitnami Redis subchart.    |
| `service.type`        | `ClusterIP`                         | Service type.                         |
| `service.port`        | `8790`                              | Service port.                         |
| `server.port`         | `8790`                              | Container port (`PORT`).              |
| `autoscaling.enabled` | `false`                             | Enable a HorizontalPodAutoscaler.     |
| `podDisruptionBudget.enabled` | `false`                       | Enable a PodDisruptionBudget (`minAvailable` defaults to `1`). |
| `podSecurityContext`  | non-root UID/GID `10001`            | Pod-level restricted security defaults. |
| `securityContext`     | read-only root FS + drop all capabilities | Container-level restricted security defaults. |
| `resources`           | 100m/256Mi requests, 200m/512Mi limits | Container CPU, memory, and ephemeral-storage requests/limits. |
| `mtls.enabled`        | `false`                             | HTTPS listener + controller→server mTLS (`TRUEFORGE_MTLS_*`). When true, probes use `scheme: HTTPS`. |
| `mtls.secretName`     | `""`                                | Secret with `tls.crt` / `tls.key` / `ca.crt` (required when `mtls.enabled`). |
| `mtls.certsDir`       | `/etc/tls`                          | Mount path / `TRUEFORGE_MTLS_CERTS_DIR`. |

The server uses a RollingUpdate strategy by default (`server.strategy`); the
controller is fixed to a single replica with `Recreate` and exposes neither.

Also available (defaults inert): `priorityClassName`,
`topologySpreadConstraints`, `initContainers`, `extraContainers`,
`extraVolumes`, `extraVolumeMounts`, `service.annotations`, `service.labels`,
`startupProbe`.

The server container mounts an `emptyDir` at `/tmp` by default so the image can
run with `readOnlyRootFilesystem: true`. When set, `resources.limits.ephemeral-storage`
also sets the `/tmp` `emptyDir.sizeLimit`.

## Production checklist

- **Enable `configs.oidc`** — leaving it off grants shared admin to anyone who can reach the server.
- **Replace the bundled Postgres password** (`trueforge`) or set `postgresql.auth.existingSecret`.
- Treat bundled Redis (`redis.auth.enabled: false`) as cluster-internal only, or switch to external passworded Redis via `externalRedis.url`.
- Set `server.publicBaseUrl` to the real public origin before using MCP OAuth or OIDC.
- Prefer `valueFrom.secretKeyRef` for Postgres password, Redis URL, and OIDC client secret; do not commit secrets in values files.
- Prefer external managed Postgres/Redis over the bundled subcharts for production HA.
- If enabling `mtls`, set `mtls.secretName` and ensure any reverse proxy dials HTTPS with a trusted client cert (see Caddy `internal_mtls`).
- Tune container `resources` (especially CPU requests) before enabling HPA.
- Default `tfy.jfrog.io` images and the Helm chart are anonymously pullable — set `imagePullSecrets` only if you override to a private registry.
- Enable `podDisruptionBudget` when running multiple replicas (defaults to `minAvailable: 1`; set exactly one of `minAvailable` or `maxUnavailable`).
