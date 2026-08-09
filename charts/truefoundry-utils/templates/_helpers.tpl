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
Name of the Secret holding the Postgres password, and its key.
- bundled: the subchart's Secret (existingSecret override or <release>-postgresql, key `password`).
- external existingSecret: that Secret and its passwordKey.
- external literal password: a Secret this chart renders (see secret.yaml).
*/}}
{{- define "truefoundry-utils.postgres.secretName" -}}
{{- if .Values.postgresql.enabled -}}
{{- default (printf "%s-postgresql" .Release.Name) .Values.postgresql.auth.existingSecret -}}
{{- else if .Values.externalPostgres.existingSecret -}}
{{- .Values.externalPostgres.existingSecret -}}
{{- else -}}
{{- $_ := required "externalPostgres.password or externalPostgres.existingSecret is required when postgresql.enabled is false" .Values.externalPostgres.password -}}
{{- printf "%s-postgres" (include "truefoundry-utils.fullname" .) -}}
{{- end -}}
{{- end }}

{{- define "truefoundry-utils.postgres.secretKey" -}}
{{- if .Values.postgresql.enabled -}}password{{- else -}}{{ .Values.externalPostgres.passwordKey }}{{- end -}}
{{- end }}

{{/*
True when REDIS_URL should be loaded from externalRedis.existingSecret.
*/}}
{{- define "truefoundry-utils.redis.useSecret" -}}
{{- if and (not .Values.redis.enabled) .Values.externalRedis.existingSecret -}}true{{- end -}}
{{- end }}

{{/*
Redis connection URL literal. Used when redis is bundled, or when external
Redis is configured via externalRedis.url (not existingSecret).
*/}}
{{- define "truefoundry-utils.redis.url" -}}
{{- if .Values.redis.enabled -}}
{{- printf "redis://%s-redis-master:6379" .Release.Name -}}
{{- else if .Values.externalRedis.existingSecret -}}
{{- fail "truefoundry-utils.redis.url must not be used when externalRedis.existingSecret is set" -}}
{{- else -}}
{{- required "externalRedis.url or externalRedis.existingSecret is required when redis.enabled is false (the server always needs Redis)" .Values.externalRedis.url -}}
{{- end -}}
{{- end }}
