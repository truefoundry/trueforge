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
helm.sh/chart: {{ include "trueforge.chart" . }}
{{ include "trueforge.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "trueforge.selectorLabels" -}}
app.kubernetes.io/name: {{ include "trueforge.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
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
Name of the Secret holding the Postgres password, and its key.
- bundled: the subchart's Secret (existingSecret override or <release>-postgresql, key `password`).
- external existingSecret: that Secret and its passwordKey.
- external literal password: a Secret this chart renders (see secret.yaml).
*/}}
{{- define "trueforge.postgres.secretName" -}}
{{- if .Values.postgresql.enabled -}}
{{- default (printf "%s-postgresql" .Release.Name) .Values.postgresql.auth.existingSecret -}}
{{- else if .Values.externalPostgres.existingSecret -}}
{{- .Values.externalPostgres.existingSecret -}}
{{- else -}}
{{- $_ := required "externalPostgres.password or externalPostgres.existingSecret is required when postgresql.enabled is false" .Values.externalPostgres.password -}}
{{- printf "%s-postgres" (include "trueforge.fullname" .) -}}
{{- end -}}
{{- end }}

{{- define "trueforge.postgres.secretKey" -}}
{{- if .Values.postgresql.enabled -}}password{{- else -}}{{ .Values.externalPostgres.passwordKey }}{{- end -}}
{{- end }}

{{/*
Redis connection URL. The server always runs peered, so a Redis is always
required: the bundled auth-less standalone master, or externalRedis.url.
*/}}
{{- define "trueforge.redis.url" -}}
{{- if .Values.redis.enabled -}}
{{- printf "redis://%s-redis-master:6379" .Release.Name -}}
{{- else -}}
{{- required "externalRedis.url is required when redis.enabled is false (the server always needs Redis)" .Values.externalRedis.url -}}
{{- end -}}
{{- end }}
