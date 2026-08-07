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
`postgresql.auth.password` (or `postgresql.auth.existingSecret`), and
`postgresql.auth.database`; the server connects to it automatically.

To use an **external** Postgres, set `postgresql.enabled=false` and provide
`externalPostgres.host` (+ `port`, `database`, `user`) with the password one of
two ways:

- Set `externalPostgres.password` and the chart renders a `Secret`, or
- Set `externalPostgres.existingSecret` (and optionally `externalPostgres.passwordKey`,
  default `password`) to reference a `Secret` you manage.

## Redis

The server always runs peered (`STANDALONE=false`), so Redis is always required.
Bundled by default (`redis.enabled=true`, auth disabled). To use an **external**
Redis, set `redis.enabled=false` and provide the connection URL one of two ways:

- Set `externalRedis.url` (literal; fine for local/dev), or
- Set `externalRedis.existingSecret` (and optionally `externalRedis.urlKey`,
  default `redis-url`) to reference a `Secret` you manage.

For passworded Redis, prefer an external instance and load `REDIS_URL` from a Secret.

## Using Secrets

Prefer Kubernetes Secrets over literals in values files for production.

**Bundled Postgres password** — Bitnami `postgresql.auth.existingSecret` (key `password`):

```yaml
postgresql:
  auth:
    existingSecret: my-postgres-secret
    # leave password empty / unused when existingSecret is set
```

**External Postgres password**:

```yaml
postgresql:
  enabled: false
externalPostgres:
  host: postgres.databases.svc
  existingSecret: my-postgres-secret
  passwordKey: password
```

**External Redis URL**:

```yaml
redis:
  enabled: false
externalRedis:
  existingSecret: my-redis-secret
  urlKey: redis-url
```

**OIDC and other env secrets** — use `server.extraEnv` / `server.extraEnvFrom`
(first-class OIDC values are not wired yet):

```yaml
server:
  extraEnv:
    - name: OIDC_ISSUER_URL
      value: https://idp.example.com
    - name: OIDC_CLIENT_ID
      valueFrom:
        secretKeyRef:
          name: truefoundry-utils-oidc
          key: client-id
    - name: OIDC_CLIENT_SECRET
      valueFrom:
        secretKeyRef:
          name: truefoundry-utils-oidc
          key: client-secret
```

Or load a whole Secret as env:

```yaml
server:
  extraEnvFrom:
    - secretRef:
        name: truefoundry-utils-oidc
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
| `server.publicBaseUrl`| `""`                                | Public origin for OAuth/OIDC callbacks. |
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
- Prefer `existingSecret` for Postgres and Redis credentials; do not commit passwords in values files.
- Prefer external managed Postgres/Redis over the bundled subcharts for production HA.
- Set container `resources` (especially CPU requests) before enabling HPA.
- Add `imagePullSecrets` when pulling from `tfy.jfrog.io`.
- Configure OIDC via `server.extraEnv` / `extraEnvFrom` when you need IdP login.
- Enable `podDisruptionBudget` when running multiple replicas (defaults to `minAvailable: 1`; set exactly one of `minAvailable` or `maxUnavailable`).
