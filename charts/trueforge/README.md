# trueforge Helm chart

Deploys the TrueForge server, a single container image that serves both the API
and the UI (built from the repository-root `Dockerfile`).

The chart version, `appVersion`, and `image.tag` are stamped from the Git tag by
[`.github/workflows/release-image-and-chart.yml`](../../.github/workflows/release-image-and-chart.yml)
when a GitHub Release is published, so the committed values reflect the last
release.

## Dependencies

Postgres and Redis ship as **bundled** dependencies (the Bitnami `postgresql`
and `redis` charts, pulled from the public Bitnami OCI archive and pinned by
`Chart.lock`). They are enabled by default, so a basic install only needs
`server.publicBaseUrl`. The chart wires the server's `POSTGRES_*` and
`REDIS_URL` env to the bundled services automatically.

The Bitnami **charts** are still public, but the **container images** they
reference were moved to `docker.io/bitnamilegacy`, so `values.yaml` overrides the
subchart images to pinned tags mirrored to the TrueFoundry JFrog registry
(`tfy.jfrog.io/tfy-mirror/bitnamilegacy/...`). This trips Bitnami's registry
guardrail, so `global.security.allowInsecureImages: true` is set for the
subcharts to render.

Disable either dependency to point at an external service instead (see below).

## Install

```bash
helm install trueforge oci://<jfrog-public-helm-repo>/trueforge \
  --version <x.y.z> \
  --set server.publicBaseUrl=https://trueforge.example.com
```

## Required values

| Value                  | Description                                                |
| ---------------------- | ---------------------------------------------------------- |
| `server.publicBaseUrl` | Public origin for MCP OAuth callbacks (`PUBLIC_BASE_URL`). |

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

The server always runs peered (`SINGLE_BINARY=false`), so Redis is always
required. Bundled by default (`redis.enabled=true`, auth disabled). To use an
**external** Redis, set `redis.enabled=false` and `externalRedis.url`.

## Extra objects

Deploy arbitrary manifests alongside the server (for example an Istio
`VirtualService`, a `Gateway`, an `Ingress`, or a `NetworkPolicy`) via
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
| `replicaCount`        | `1`                                 | Number of server replicas.            |
| `image.repository`    | `tfy.jfrog.io/tfy-images/trueforge` | Image repository.                     |
| `image.tag`           | chart `appVersion`                  | Image tag; stamped on release.        |
| `postgresql.enabled`  | `true`                              | Bundle the Bitnami Postgres subchart. |
| `redis.enabled`       | `true`                              | Bundle the Bitnami Redis subchart.    |
| `service.type`        | `ClusterIP`                         | Service type.                         |
| `service.port`        | `8790`                              | Service port.                         |
| `server.port`         | `8790`                              | Container port (`PORT`).              |
| `autoscaling.enabled` | `false`                             | Enable a HorizontalPodAutoscaler.     |
| `resources`           | `{}`                                | Container resource requests/limits.   |
