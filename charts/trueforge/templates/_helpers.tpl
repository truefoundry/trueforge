{{/*
Expand the name of the chart.
*/}}
{{- define "trueforge.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "trueforge.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version as used by the chart label.
*/}}
{{- define "trueforge.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "trueforge.labels" -}}
{{- $base := dict "helm.sh/chart" (include "trueforge.chart" .) "app.kubernetes.io/managed-by" .Release.Service -}}
{{- if .Chart.AppVersion -}}
{{- $_ := set $base "app.kubernetes.io/version" (.Chart.AppVersion | toString) -}}
{{- end -}}
{{- $selector := include "trueforge.selectorLabels" . | fromYaml -}}
{{- toYaml (mergeOverwrite $base (deepCopy (.Values.global.labels | default dict)) (deepCopy .Values.commonLabels) $selector) -}}
{{- end }}

{{/*
Annotations applied to every rendered object.
*/}}
{{- define "trueforge.annotations" -}}
{{- $merged := mergeOverwrite (deepCopy (.Values.global.annotations | default dict)) (deepCopy .Values.commonAnnotations) -}}
{{- with $merged }}
{{- toYaml . }}
{{- end }}
{{- end }}

{{/*
Pod labels / annotations, global merged under the chart's own.
*/}}
{{- define "trueforge.podLabels" -}}
{{- $merged := mergeOverwrite (deepCopy (.Values.global.podLabels | default dict)) (deepCopy .Values.podLabels) -}}
{{- with $merged }}
{{- toYaml . }}
{{- end }}
{{- end }}

{{- define "trueforge.podAnnotations" -}}
{{- $merged := mergeOverwrite (deepCopy (.Values.global.podAnnotations | default dict)) (deepCopy .Values.podAnnotations) -}}
{{- with $merged }}
{{- toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "trueforge.selectorLabels" -}}
app.kubernetes.io/name: {{ include "trueforge.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Controller selector labels. A distinct app name (…-controller) keeps the server
Service (which selects trueforge.selectorLabels) from ever routing HTTP traffic
to controller pods, which run no HTTP server.
*/}}
{{- define "trueforge.controller.selectorLabels" -}}
app.kubernetes.io/name: {{ include "trueforge.name" . }}-controller
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Controller labels.
*/}}
{{- define "trueforge.controller.labels" -}}
{{- $base := dict "helm.sh/chart" (include "trueforge.chart" .) "app.kubernetes.io/managed-by" .Release.Service "app.kubernetes.io/component" "controller" -}}
{{- if .Chart.AppVersion -}}
{{- $_ := set $base "app.kubernetes.io/version" (.Chart.AppVersion | toString) -}}
{{- end -}}
{{- $selector := include "trueforge.controller.selectorLabels" . | fromYaml -}}
{{- toYaml (mergeOverwrite $base (deepCopy (.Values.global.labels | default dict)) (deepCopy .Values.commonLabels) $selector) -}}
{{- end }}

{{/*
Base URL the controller uses to reach the server API. Defaults to the in-cluster
server Service when controller.serverUrl is empty (https when mtls is enabled).
*/}}
{{- define "trueforge.controller.serverUrl" -}}
{{- if .Values.controller.serverUrl -}}
{{- .Values.controller.serverUrl -}}
{{- else -}}
{{- printf "%s://%s:%v" (ternary "https" "http" .Values.mtls.enabled) (include "trueforge.fullname" .) .Values.service.port -}}
{{- end -}}
{{- end }}

{{/*
Service account name.
*/}}
{{- define "trueforge.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "trueforge.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Container image reference; tag falls back to the chart appVersion.
*/}}
{{- define "trueforge.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}

{{/*
True when .value is a non-empty string (vs a valueFrom map).
Expects dict with key "value".
*/}}
{{- define "trueforge.isLiteralString" -}}
{{- $v := index . "value" -}}
{{- if and (kindIs "string" $v) (ne $v "") -}}true{{- end -}}
{{- end }}

{{/*
Fail unless .value is a non-empty string or a map with valueFrom.
Expects dict with keys "name" and "value".
*/}}
{{- define "trueforge.requireStringOrValueFrom" -}}
{{- $v := index . "value" -}}
{{- $name := index . "name" -}}
{{- if kindIs "string" $v -}}
{{- if eq $v "" -}}{{- fail (printf "%s is required (string or valueFrom.secretKeyRef)" $name) -}}{{- end -}}
{{- else if kindIs "map" $v -}}
{{- if not $v.valueFrom -}}{{- fail (printf "%s map must set valueFrom" $name) -}}{{- end -}}
{{- else -}}
{{- fail (printf "%s must be a string or a valueFrom object" $name) -}}
{{- end -}}
{{- end }}

{{/*
Postgres connection. Sourced from the bundled Bitnami postgresql subchart when
postgresql.enabled, otherwise from externalPostgres.
*/}}
{{- define "trueforge.postgres.host" -}}
{{- if .Values.postgresql.enabled -}}
{{- printf "%s-postgresql" .Release.Name -}}
{{- else -}}
{{- required "externalPostgres.host is required when postgresql.enabled is false" .Values.externalPostgres.host -}}
{{- end -}}
{{- end }}

{{- define "trueforge.postgres.port" -}}
{{- if .Values.postgresql.enabled -}}5432{{- else -}}{{ .Values.externalPostgres.port }}{{- end -}}
{{- end }}

{{- define "trueforge.postgres.user" -}}
{{- if .Values.postgresql.enabled -}}{{ .Values.postgresql.auth.username }}{{- else -}}{{ .Values.externalPostgres.user }}{{- end -}}
{{- end }}

{{- define "trueforge.postgres.database" -}}
{{- if .Values.postgresql.enabled -}}{{ .Values.postgresql.auth.database }}{{- else -}}{{ .Values.externalPostgres.database }}{{- end -}}
{{- end }}

{{/*
Name of the Secret holding the Postgres password when using the bundled
postgresql subchart (existingSecret override or <release>-postgresql).
*/}}
{{- define "trueforge.postgres.secretName" -}}
{{- default (printf "%s-postgresql" .Release.Name) .Values.postgresql.auth.existingSecret -}}
{{- end }}

{{- define "trueforge.redis.bundledUrl" -}}
{{- printf "redis://%s-redis-master:6379" .Release.Name -}}
{{- end }}

{{/*
Resource tier (small | medium | large). Empty when unset so the explicit
`resources` / `controller.resources` apply. resourceTier wins over a parent
chart's global.resourceTier.
*/}}
{{- define "trueforge.resourceTier" -}}
{{- $override := .Values.resourceTier | default "" | toString | trim -}}
{{- $fromGlobal := "" -}}
{{- with .Values.global -}}
{{- $fromGlobal = .resourceTier | default "" | toString | trim -}}
{{- end -}}
{{- $tier := $override | default $fromGlobal -}}
{{- if $tier -}}
{{- if not (has $tier (list "small" "medium" "large")) -}}
{{- fail (printf "resourceTier must be small, medium, or large (got %q)" $tier) -}}
{{- end -}}
{{- $tier -}}
{{- end -}}
{{- end }}

{{- define "trueforge.replicas" -}}
{{- .Values.server.replicaCount -}}
{{- end }}

{{- define "trueforge.defaultResources.small" -}}
requests:
  cpu: 50m
  memory: 128Mi
  ephemeral-storage: 128Mi
limits:
  cpu: 100m
  memory: 256Mi
  ephemeral-storage: 256Mi
{{- end }}

{{- define "trueforge.defaultResources.medium" -}}
requests:
  cpu: 100m
  memory: 256Mi
  ephemeral-storage: 256Mi
limits:
  cpu: 200m
  memory: 512Mi
  ephemeral-storage: 512Mi
{{- end }}

{{- define "trueforge.defaultResources.large" -}}
requests:
  cpu: 500m
  memory: 512Mi
  ephemeral-storage: 512Mi
limits:
  cpu: 1000m
  memory: 1024Mi
  ephemeral-storage: 1024Mi
{{- end }}

{{- define "trueforge.controller.defaultResources.small" -}}
requests:
  cpu: 50m
  memory: 128Mi
  ephemeral-storage: 128Mi
limits:
  cpu: 100m
  memory: 256Mi
  ephemeral-storage: 256Mi
{{- end }}

{{- define "trueforge.controller.defaultResources.medium" -}}
requests:
  cpu: 100m
  memory: 256Mi
  ephemeral-storage: 128Mi
limits:
  cpu: 200m
  memory: 512Mi
  ephemeral-storage: 256Mi
{{- end }}

{{- define "trueforge.controller.defaultResources.large" -}}
requests:
  cpu: 500m
  memory: 512Mi
  ephemeral-storage: 128Mi
limits:
  cpu: 1000m
  memory: 1024Mi
  ephemeral-storage: 256Mi
{{- end }}

{{/*
Server requests/limits. Default is `.Values.resources`. A resourceTier preset
replaces that table (chart resource defaults must not overlay it).
*/}}
{{- define "trueforge.resources" -}}
{{- $tier := include "trueforge.resourceTier" . | trim -}}
{{- if $tier -}}
{{- $defaultsYaml := "" -}}
{{- if eq $tier "small" -}}
  {{- $defaultsYaml = include "trueforge.defaultResources.small" . -}}
{{- else if eq $tier "medium" -}}
  {{- $defaultsYaml = include "trueforge.defaultResources.medium" . -}}
{{- else if eq $tier "large" -}}
  {{- $defaultsYaml = include "trueforge.defaultResources.large" . -}}
{{- end -}}
{{- $defaultsYaml -}}
{{- else -}}
{{- toYaml (.Values.resources | default dict) -}}
{{- end -}}
{{- end }}

{{/*
Controller requests/limits. Default is `.Values.controller.resources`.
Replica count is always 1, even when a resourceTier is set.
*/}}
{{- define "trueforge.controller.resources" -}}
{{- $tier := include "trueforge.resourceTier" . | trim -}}
{{- if $tier -}}
{{- $defaultsYaml := "" -}}
{{- if eq $tier "small" -}}
  {{- $defaultsYaml = include "trueforge.controller.defaultResources.small" . -}}
{{- else if eq $tier "medium" -}}
  {{- $defaultsYaml = include "trueforge.controller.defaultResources.medium" . -}}
{{- else if eq $tier "large" -}}
  {{- $defaultsYaml = include "trueforge.controller.defaultResources.large" . -}}
{{- end -}}
{{- $defaultsYaml -}}
{{- else -}}
{{- toYaml (.Values.controller.resources | default dict) -}}
{{- end -}}
{{- end }}

{{- define "trueforge.tmpEmptyDirSizeLimit" -}}
{{- $merged := include "trueforge.resources" . | fromYaml | default dict -}}
{{- index ($merged.limits | default dict) "ephemeral-storage" -}}
{{- end }}

{{- define "trueforge.controller.tmpEmptyDirSizeLimit" -}}
{{- $merged := include "trueforge.controller.resources" . | fromYaml | default dict -}}
{{- index ($merged.limits | default dict) "ephemeral-storage" -}}
{{- end }}

{{/*
JSON env entry from a string | { valueFrom: ... } field.
Expects: name (env var), field (values path for errors), value.
Literals become env value; valueFrom maps are passed through. The chart does
not create Secrets; callers who need secretKeyRef must supply valueFrom.
*/}}
{{- define "trueforge.env.fromStringOrValueFrom" -}}
{{- $name := index . "name" -}}
{{- $field := index . "field" -}}
{{- $value := index . "value" -}}
{{- include "trueforge.requireStringOrValueFrom" (dict "name" $field "value" $value) -}}
{{- if eq (include "trueforge.isLiteralString" (dict "value" $value)) "true" -}}
{{- dict "name" $name "value" $value | toJson -}}
{{- else -}}
{{- dict "name" $name "valueFrom" $value.valueFrom | toJson -}}
{{- end -}}
{{- end }}

{{/*
One env entry from the `env` map. Scalars become a literal value; a map must
carry valueFrom and is passed through untouched.
*/}}
{{- define "trueforge.env.item" -}}
{{- $name := index . "name" -}}
{{- $value := index . "value" -}}
{{- if kindIs "map" $value -}}
{{- if not $value.valueFrom -}}{{- fail (printf "env.%s must set valueFrom when given as a map" $name) -}}{{- end -}}
{{- dict "name" $name "valueFrom" $value.valueFrom | toJson -}}
{{- else -}}
{{- dict "name" $name "value" ($value | toString) | toJson -}}
{{- end -}}
{{- end }}

{{/*
Full server container env list (YAML). Validates required string|valueFrom
fields, wires bundled Postgres/Redis, optional OIDC, then server.extraEnv.
*/}}
{{- define "trueforge.server.env" -}}
{{- $env := list -}}
{{- $env = append $env (dict "name" "NODE_ENV" "value" "production") -}}
{{- $env = append $env (dict "name" "PORT" "value" (.Values.server.port | toString)) -}}
{{- $env = append $env (dict "name" "PUBLIC_BASE_URL" "value" .Values.server.publicBaseUrl) -}}
{{- $env = append $env (dict "name" "STANDALONE" "value" "false") -}}
{{- $env = append $env (dict "name" "GRACEFUL_TIMEOUT_SECONDS" "value" (.Values.server.gracefulTimeoutSeconds | toString)) -}}

{{- if .Values.redis.enabled -}}
{{- $env = append $env (dict "name" "REDIS_URL" "value" (include "trueforge.redis.bundledUrl" .)) -}}
{{- else -}}
{{- $env = append $env (include "trueforge.env.fromStringOrValueFrom" (dict "name" "REDIS_URL" "field" "externalRedis.url" "value" .Values.externalRedis.url) | fromJson) -}}
{{- $sentinel := .Values.externalRedis.sentinel | default dict -}}
{{- if $sentinel.enabled -}}
{{- $_ := required "externalRedis.sentinel.hosts is required when externalRedis.sentinel.enabled is true" $sentinel.hosts -}}
{{- $_ := required "externalRedis.sentinel.masterName is required when externalRedis.sentinel.enabled is true" $sentinel.masterName -}}
{{- $env = append $env (dict "name" "REDIS_SENTINEL_HOSTS" "value" $sentinel.hosts) -}}
{{- $env = append $env (dict "name" "REDIS_SENTINEL_MASTER_NAME" "value" $sentinel.masterName) -}}
{{- if $sentinel.password -}}
{{- $env = append $env (include "trueforge.env.fromStringOrValueFrom" (dict "name" "REDIS_SENTINEL_PASSWORD" "field" "externalRedis.sentinel.password" "value" $sentinel.password) | fromJson) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- $env = append $env (dict "name" "POSTGRES_HOST" "value" (include "trueforge.postgres.host" .)) -}}
{{- $env = append $env (dict "name" "POSTGRES_PORT" "value" (include "trueforge.postgres.port" . | toString)) -}}
{{- $env = append $env (dict "name" "POSTGRES_DB" "value" (include "trueforge.postgres.database" .)) -}}
{{- $env = append $env (dict "name" "POSTGRES_USER" "value" (include "trueforge.postgres.user" .)) -}}
{{- if .Values.postgresql.enabled -}}
{{- $env = append $env (dict "name" "POSTGRES_PASSWORD" "valueFrom" (dict "secretKeyRef" (dict "name" (include "trueforge.postgres.secretName" .) "key" "password"))) -}}
{{- else -}}
{{- $env = append $env (include "trueforge.env.fromStringOrValueFrom" (dict "name" "POSTGRES_PASSWORD" "field" "externalPostgres.password" "value" .Values.externalPostgres.password) | fromJson) -}}
{{- if .Values.externalPostgres.sslMode -}}
{{- $env = append $env (dict "name" "POSTGRES_SSL_MODE" "value" .Values.externalPostgres.sslMode) -}}
{{- end -}}
{{- end -}}

{{- if .Values.configs.oidc.enabled -}}
{{- $_ := required "configs.oidc.issuerUrl is required when configs.oidc.enabled is true" .Values.configs.oidc.issuerUrl -}}
{{- $_ := required "configs.oidc.clientId is required when configs.oidc.enabled is true" .Values.configs.oidc.clientId -}}
{{- $env = append $env (dict "name" "OIDC_ISSUER_URL" "value" .Values.configs.oidc.issuerUrl) -}}
{{- $env = append $env (dict "name" "OIDC_CLIENT_ID" "value" .Values.configs.oidc.clientId) -}}
{{- $env = append $env (include "trueforge.env.fromStringOrValueFrom" (dict "name" "OIDC_CLIENT_SECRET" "field" "configs.oidc.clientSecret" "value" .Values.configs.oidc.clientSecret) | fromJson) -}}
{{- $env = append $env (dict "name" "OIDC_USER_REFERENCE_CLAIM" "value" .Values.configs.oidc.userReferenceClaim) -}}
{{- $env = append $env (dict "name" "OIDC_USER_DISPLAY_NAME_CLAIM" "value" .Values.configs.oidc.userDisplayNameClaim) -}}
{{- $env = append $env (dict "name" "OIDC_USER_ROLE_CLAIM" "value" .Values.configs.oidc.userRoleClaim) -}}
{{- $env = append $env (dict "name" "OIDC_ADMIN_ROLE_VALUE" "value" .Values.configs.oidc.adminRoleValue) -}}
{{- $env = append $env (dict "name" "OIDC_SCOPES" "value" .Values.configs.oidc.scopes) -}}
{{- if .Values.configs.oidc.allowedEmails -}}
{{- $env = append $env (dict "name" "OIDC_ALLOWED_EMAILS" "value" .Values.configs.oidc.allowedEmails) -}}
{{- end -}}
{{- end -}}

{{- /* Controller -> server auth. The app rejects an empty value when peered. */ -}}
{{- $env = append $env (include "trueforge.env.fromStringOrValueFrom" (dict "name" "TRUEFORGE_API_KEY" "field" "apiKey" "value" .Values.apiKey) | fromJson) -}}

{{- /* Node reads its own bundled CA store unless told otherwise. */ -}}
{{- if eq (include "trueforge.customCA.enabled" .) "true" -}}
{{- $env = append $env (dict "name" "NODE_EXTRA_CA_CERTS" "value" "/etc/ssl/certs/ca-certificates.crt") -}}
{{- end -}}

{{- /* env map: replace in place when the chart already emits the name, else
       append. Keeps the pod spec free of duplicate env entries. */ -}}
{{- $overrides := .Values.env | default dict -}}
{{- if $overrides -}}
{{- $out := list -}}
{{- $seen := dict -}}
{{- range $item := $env -}}
{{- if hasKey $overrides $item.name -}}
{{- $out = append $out (include "trueforge.env.item" (dict "name" $item.name "value" (index $overrides $item.name)) | fromJson) -}}
{{- else -}}
{{- $out = append $out $item -}}
{{- end -}}
{{- $_ := set $seen $item.name true -}}
{{- end -}}
{{- range $name := (keys $overrides | sortAlpha) -}}
{{- if not (hasKey $seen $name) -}}
{{- $out = append $out (include "trueforge.env.item" (dict "name" $name "value" (index $overrides $name)) | fromJson) -}}
{{- end -}}
{{- end -}}
{{- $env = $out -}}
{{- end -}}

{{- range .Values.server.extraEnv -}}
{{- $env = append $env . -}}
{{- end -}}

{{- if .Values.mtls.enabled -}}
{{- $_ := required "mtls.secretName is required when mtls.enabled is true" .Values.mtls.secretName -}}
{{- $env = append $env (dict "name" "TRUEFORGE_MTLS_ENABLED" "value" "true") -}}
{{- $env = append $env (dict "name" "TRUEFORGE_MTLS_CERTS_DIR" "value" .Values.mtls.certsDir) -}}
{{- end -}}

{{- toYaml $env -}}
{{- end }}

{{/*
httpGet probe with scheme HTTPS when mtls.enabled (kubelet speaks TLS without a client cert).
Expects dict: probe (values probe object), root (chart root context).
*/}}
{{- define "trueforge.httpProbe" -}}
{{- $probe := deepCopy (index . "probe") -}}
{{- $root := index . "root" -}}
{{- if and $root.Values.mtls.enabled $probe.httpGet -}}
{{- $_ := set $probe.httpGet "scheme" "HTTPS" -}}
{{- end -}}
{{- toYaml $probe -}}
{{- end }}

{{/*
mTLS secret volume when mtls.enabled.
*/}}
{{- define "trueforge.mtlsVolume" -}}
{{- if .Values.mtls.enabled -}}
- name: mtls
  secret:
    secretName: {{ .Values.mtls.secretName | quote }}
{{- end -}}
{{- end }}

{{/*
mTLS secret volumeMount when mtls.enabled.
*/}}
{{- define "trueforge.mtlsVolumeMount" -}}
{{- if .Values.mtls.enabled -}}
- name: mtls
  mountPath: {{ .Values.mtls.certsDir | quote }}
  readOnly: true
{{- end -}}
{{- end }}

{{/*
Scheduling and pull secrets. A parent chart's global.* is the base; the chart's
own value wins. Tolerations append rather than replace.
*/}}
{{- define "trueforge.imagePullSecrets" -}}
{{- $secrets := .Values.imagePullSecrets | default (.Values.global.imagePullSecrets | default list) -}}
{{- with $secrets }}
{{- toYaml . }}
{{- end }}
{{- end }}

{{- define "trueforge.nodeSelector" -}}
{{- $merged := mergeOverwrite (deepCopy (.Values.global.nodeSelector | default dict)) (deepCopy .Values.nodeSelector) -}}
{{- with $merged }}
{{- toYaml . }}
{{- end }}
{{- end }}

{{- define "trueforge.affinity" -}}
{{- $merged := mergeOverwrite (deepCopy (.Values.global.affinity | default dict)) (deepCopy .Values.affinity) -}}
{{- with $merged }}
{{- toYaml . }}
{{- end }}
{{- end }}

{{- define "trueforge.tolerations" -}}
{{- $merged := concat (.Values.global.tolerations | default list) (.Values.tolerations | default list) -}}
{{- with $merged }}
{{- toYaml . }}
{{- end }}
{{- end }}

{{/*
Custom CA. Honours global.customCA whether set on this chart (standalone) or
inherited from a parent chart. Two modes: mount an operator-supplied full
bundle straight over /etc/ssl/certs, or merge a CA into the system bundle with
an initContainer. The chart renders its own ConfigMap when given a certificate,
so it does not depend on one the parent may or may not have created.
*/}}
{{- define "trueforge.customCA" -}}
{{- .Values.global.customCA | default dict | toYaml -}}
{{- end }}

{{- define "trueforge.customCA.enabled" -}}
{{- $ca := include "trueforge.customCA" . | fromYaml -}}
{{- if $ca.enabled -}}true{{- end -}}
{{- end }}

{{- define "trueforge.customCA.validate" -}}
{{- $ca := include "trueforge.customCA" . | fromYaml -}}
{{- if $ca.enabled -}}
{{- $existing := ($ca.existingConfigMap | default dict).name -}}
{{- if and (not $ca.certificate) (not $existing) -}}
{{- fail "global.customCA.enabled is true but neither global.customCA.certificate nor global.customCA.existingConfigMap.name is set. Provide one of them." -}}
{{- end -}}
{{- end -}}
{{- end }}

{{- define "trueforge.customCA.useDirectMount" -}}
{{- $ca := include "trueforge.customCA" . | fromYaml -}}
{{- $existing := $ca.existingConfigMap | default dict -}}
{{- if and $existing.name $existing.overrideCAList -}}true{{- end -}}
{{- end }}

{{- define "trueforge.customCA.configMapName" -}}
{{- include "trueforge.customCA.validate" . -}}
{{- $ca := include "trueforge.customCA" . | fromYaml -}}
{{- $existing := ($ca.existingConfigMap | default dict).name -}}
{{- if $existing -}}
{{- $existing -}}
{{- else -}}
{{- printf "%s-custom-ca" (include "trueforge.fullname" .) -}}
{{- end -}}
{{- end }}

{{- define "trueforge.customCA.initContainer" -}}
{{- if eq (include "trueforge.customCA.enabled" .) "true" }}
{{- if ne (include "trueforge.customCA.useDirectMount" .) "true" }}
{{- $ca := include "trueforge.customCA" . | fromYaml }}
{{- $image := $ca.image | default dict }}
- name: configure-custom-ca
  image: "{{ $image.registry | default "tfy.jfrog.io" }}/{{ $image.repository }}:{{ $image.tag }}"
  imagePullPolicy: {{ .Values.image.pullPolicy }}
  {{- with $ca.securityContext }}
  securityContext:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  command: ["sh", "-c"]
  args:
    - |
      set -e
      cat /etc/ssl/certs/ca-certificates.crt /custom-ca/ca-certificates.crt > /ssl-certs/ca-certificates.crt
  {{- with $ca.env }}
  env:
    {{- range $key, $val := . }}
    - name: {{ $key }}
      value: {{ $val | quote }}
    {{- end }}
  {{- end }}
  volumeMounts:
    - name: custom-ca
      mountPath: /custom-ca
      readOnly: true
    - name: ssl-certs
      mountPath: /ssl-certs
{{- end }}
{{- end }}
{{- end }}

{{- define "trueforge.customCA.volumes" -}}
{{- if eq (include "trueforge.customCA.enabled" .) "true" }}
{{- $ca := include "trueforge.customCA" . | fromYaml }}
- name: custom-ca
  configMap:
    name: {{ include "trueforge.customCA.configMapName" . }}
{{- if ne (include "trueforge.customCA.useDirectMount" .) "true" }}
- name: ssl-certs
  emptyDir:
    sizeLimit: {{ (($ca.emptyDir | default dict).sslCerts | default dict).sizeLimit | default "10Mi" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "trueforge.customCA.volumeMounts" -}}
{{- if eq (include "trueforge.customCA.enabled" .) "true" }}
{{- if eq (include "trueforge.customCA.useDirectMount" .) "true" }}
- name: custom-ca
  mountPath: /etc/ssl/certs
  readOnly: true
{{- else }}
- name: ssl-certs
  mountPath: /etc/ssl/certs
  readOnly: true
{{- end }}
{{- end }}
{{- end }}
