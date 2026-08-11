# truefoundry-utils Helm chart

Deploys the TrueFoundry Utils server, a single container image that serves both the API
and the UI (built from the repository-root `Dockerfile`).

The chart always runs the server in **distributed** mode (`STANDALONE=false`) against
Postgres and Redis.

The chart version, `appVersion`, and `image.tag` are stamped at publish time by
[`.github/workflows/release-image-and-chart.yml`](../../.github/workflows/release-image-and-chart.yml)
(manual `workflow_dispatch`, commit SHA as the image tag). Committed chart
values are placeholders until that workflow runs.

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
helm install truefoundry-utils oci://<jfrog-public-helm-repo>/truefoundry-utils \
  --version <x.y.z>
```

Optional: set the public origin once you expose the service (needed for MCP OAuth
and OIDC callbacks):

```bash
helm upgrade --install truefoundry-utils oci://<jfrog-public-helm-repo>/truefoundry-utils \
  --version <x.y.z> \
  --set server.publicBaseUrl=https://truefoundry-utils.example.com
```

## Postgres

Bundled by default (`postgresql.enabled=true`). Set `postgresql.auth.username`,
`postgresql.auth.password` (or Bitnami's `postgresql.auth.existingSecret`), and
`postgresql.auth.database`; the server connects to it automatically.

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
Bundled by default (`redis.enabled=true`, auth disabled). To use an **external**
Redis, set `redis.enabled=false` and provide `externalRedis.url` as a string or
`valueFrom.secretKeyRef`:

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

Configure IdP login under `configs.oidc`. When `enabled` is false, no `OIDC_*`
env is set (fixed local admin identity). When enabled, set string `issuerUrl`
and `clientId`, and `clientSecret` as a string or `valueFrom.secretKeyRef`
(prefer valueFrom in production).

Also set `server.publicBaseUrl` to the public origin and register
`{publicBaseUrl}/api/v1/auth/callback` at your IdP.

```yaml
server:
  publicBaseUrl: https://truefoundry-utils.example.com
configs:
  oidc:
    enabled: true
    issuerUrl: https://idp.example.com/oauth2/default
    clientId: truefoundry-utils
    clientSecret:
      valueFrom:
        secretKeyRef:
          name: truefoundry-utils-oidc
          key: client-secret
    # optional claim overrides (defaults shown):
    # userReferenceClaim: sub
    # userRoleClaim: groups
    # adminRoleValue: admin
    # scopes: "openid,profile,email,groups"
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
      name: '{{ include "truefoundry-utils.fullname" . }}'
    spec:
      hosts:
        - truefoundry-utils.example.com
      gateways:
        - istio-system/public-gateway
      http:
        - route:
            - destination:
                host: '{{ include "truefoundry-utils.fullname" . }}'
                port:
                  number: '{{ .Values.service.port }}'
```

## Common values

| Value                 | Default                             | Description                           |
| --------------------- | ----------------------------------- | ------------------------------------- |
| `replicaCount`        | `1`                                 | Number of server replicas.            |
| `image.repository`    | `tfy.jfrog.io/tfy-images/truefoundry-utils` | Image repository.                     |
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
| `resources`           | `{}`                                | Container resource requests/limits.   |

Also available (defaults inert): `strategy`, `priorityClassName`,
`topologySpreadConstraints`, `initContainers`, `extraContainers`,
`extraVolumes`, `extraVolumeMounts`, `service.annotations`, `service.labels`,
`startupProbe`.

## Production checklist

- Set `server.publicBaseUrl` to the real public origin before using MCP OAuth or OIDC.
- Prefer `valueFrom.secretKeyRef` for Postgres password, Redis URL, and OIDC client secret; do not commit secrets in values files.
- Prefer external managed Postgres/Redis over the bundled subcharts for production HA.
- Set container `resources` (especially CPU requests) before enabling HPA.
- Add `imagePullSecrets` when pulling from `tfy.jfrog.io`.
- Configure IdP login via `configs.oidc` when you need OIDC.
- Enable `podDisruptionBudget` when running multiple replicas (defaults to `minAvailable: 1`; set exactly one of `minAvailable` or `maxUnavailable`).
