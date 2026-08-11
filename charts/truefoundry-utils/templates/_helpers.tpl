{{/*
Expand the name of the chart.
*/}}
{{- define "truefoundry-utils.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "truefoundry-utils.fullname" -}}
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
{{- define "truefoundry-utils.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "truefoundry-utils.labels" -}}
helm.sh/chart: {{ include "truefoundry-utils.chart" . }}
{{ include "truefoundry-utils.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "truefoundry-utils.selectorLabels" -}}
app.kubernetes.io/name: {{ include "truefoundry-utils.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name.
*/}}
{{- define "truefoundry-utils.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "truefoundry-utils.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Container image reference; tag falls back to the chart appVersion.
*/}}
{{- define "truefoundry-utils.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}

{{/*
True when .value is a non-empty string (vs a valueFrom map).
Expects dict with key "value".
*/}}
{{- define "truefoundry-utils.isLiteralString" -}}
{{- $v := index . "value" -}}
{{- if and (kindIs "string" $v) (ne $v "") -}}true{{- end -}}
{{- end }}

{{/*
Fail unless .value is a non-empty string or a map with valueFrom.
Expects dict with keys "name" and "value".
*/}}
{{- define "truefoundry-utils.requireStringOrValueFrom" -}}
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
{{- define "truefoundry-utils.postgres.host" -}}
{{- if .Values.postgresql.enabled -}}
{{- printf "%s-postgresql" .Release.Name -}}
{{- else -}}
{{- required "externalPostgres.host is required when postgresql.enabled is false" .Values.externalPostgres.host -}}
{{- end -}}
{{- end }}

{{- define "truefoundry-utils.postgres.port" -}}
{{- if .Values.postgresql.enabled -}}5432{{- else -}}{{ .Values.externalPostgres.port }}{{- end -}}
{{- end }}

{{- define "truefoundry-utils.postgres.user" -}}
{{- if .Values.postgresql.enabled -}}{{ .Values.postgresql.auth.username }}{{- else -}}{{ .Values.externalPostgres.user }}{{- end -}}
{{- end }}

{{- define "truefoundry-utils.postgres.database" -}}
{{- if .Values.postgresql.enabled -}}{{ .Values.postgresql.auth.database }}{{- else -}}{{ .Values.externalPostgres.database }}{{- end -}}
{{- end }}

{{/*
Name of the Secret holding the Postgres password when using the bundled
postgresql subchart (existingSecret override or <release>-postgresql).
*/}}
{{- define "truefoundry-utils.postgres.secretName" -}}
{{- default (printf "%s-postgresql" .Release.Name) .Values.postgresql.auth.existingSecret -}}
{{- end }}

{{- define "truefoundry-utils.redis.bundledUrl" -}}
{{- printf "redis://%s-redis-master:6379" .Release.Name -}}
{{- end }}

{{/*
JSON env entry from a string | { valueFrom: ... } field.
Expects: name (env var), field (values path for errors), value.
Literals become env value; valueFrom maps are passed through. The chart does
not create Secrets — callers who need secretKeyRef must supply valueFrom.
*/}}
{{- define "truefoundry-utils.env.fromStringOrValueFrom" -}}
{{- $name := index . "name" -}}
{{- $field := index . "field" -}}
{{- $value := index . "value" -}}
{{- include "truefoundry-utils.requireStringOrValueFrom" (dict "name" $field "value" $value) -}}
{{- if eq (include "truefoundry-utils.isLiteralString" (dict "value" $value)) "true" -}}
{{- dict "name" $name "value" $value | toJson -}}
{{- else -}}
{{- dict "name" $name "valueFrom" $value.valueFrom | toJson -}}
{{- end -}}
{{- end }}

{{/*
Full server container env list (YAML). Validates required string|valueFrom
fields, wires bundled Postgres/Redis, optional OIDC, then server.extraEnv.
*/}}
{{- define "truefoundry-utils.server.env" -}}
{{- $env := list -}}
{{- $env = append $env (dict "name" "NODE_ENV" "value" "production") -}}
{{- $env = append $env (dict "name" "PORT" "value" (.Values.server.port | toString)) -}}
{{- $env = append $env (dict "name" "PUBLIC_BASE_URL" "value" .Values.server.publicBaseUrl) -}}
{{- $env = append $env (dict "name" "STANDALONE" "value" "false") -}}
{{- $env = append $env (dict "name" "GRACEFUL_TIMEOUT_SECONDS" "value" (.Values.server.gracefulTimeoutSeconds | toString)) -}}

{{- if .Values.redis.enabled -}}
{{- $env = append $env (dict "name" "REDIS_URL" "value" (include "truefoundry-utils.redis.bundledUrl" .)) -}}
{{- else -}}
{{- $env = append $env (include "truefoundry-utils.env.fromStringOrValueFrom" (dict "name" "REDIS_URL" "field" "externalRedis.url" "value" .Values.externalRedis.url) | fromJson) -}}
{{- end -}}

{{- $env = append $env (dict "name" "POSTGRES_HOST" "value" (include "truefoundry-utils.postgres.host" .)) -}}
{{- $env = append $env (dict "name" "POSTGRES_PORT" "value" (include "truefoundry-utils.postgres.port" . | toString)) -}}
{{- $env = append $env (dict "name" "POSTGRES_DB" "value" (include "truefoundry-utils.postgres.database" .)) -}}
{{- $env = append $env (dict "name" "POSTGRES_USER" "value" (include "truefoundry-utils.postgres.user" .)) -}}
{{- if .Values.postgresql.enabled -}}
{{- $env = append $env (dict "name" "POSTGRES_PASSWORD" "valueFrom" (dict "secretKeyRef" (dict "name" (include "truefoundry-utils.postgres.secretName" .) "key" "password"))) -}}
{{- else -}}
{{- $env = append $env (include "truefoundry-utils.env.fromStringOrValueFrom" (dict "name" "POSTGRES_PASSWORD" "field" "externalPostgres.password" "value" .Values.externalPostgres.password) | fromJson) -}}
{{- end -}}

{{- if .Values.configs.oidc.enabled -}}
{{- $_ := required "configs.oidc.issuerUrl is required when configs.oidc.enabled is true" .Values.configs.oidc.issuerUrl -}}
{{- $_ := required "configs.oidc.clientId is required when configs.oidc.enabled is true" .Values.configs.oidc.clientId -}}
{{- $env = append $env (dict "name" "OIDC_ISSUER_URL" "value" .Values.configs.oidc.issuerUrl) -}}
{{- $env = append $env (dict "name" "OIDC_CLIENT_ID" "value" .Values.configs.oidc.clientId) -}}
{{- $env = append $env (include "truefoundry-utils.env.fromStringOrValueFrom" (dict "name" "OIDC_CLIENT_SECRET" "field" "configs.oidc.clientSecret" "value" .Values.configs.oidc.clientSecret) | fromJson) -}}
{{- $env = append $env (dict "name" "OIDC_USER_REFERENCE_CLAIM" "value" .Values.configs.oidc.userReferenceClaim) -}}
{{- $env = append $env (dict "name" "OIDC_USER_ROLE_CLAIM" "value" .Values.configs.oidc.userRoleClaim) -}}
{{- $env = append $env (dict "name" "OIDC_ADMIN_ROLE_VALUE" "value" .Values.configs.oidc.adminRoleValue) -}}
{{- $env = append $env (dict "name" "OIDC_SCOPES" "value" .Values.configs.oidc.scopes) -}}
{{- end -}}

{{- range .Values.server.extraEnv -}}
{{- $env = append $env . -}}
{{- end -}}

{{- toYaml $env -}}
{{- end }}
