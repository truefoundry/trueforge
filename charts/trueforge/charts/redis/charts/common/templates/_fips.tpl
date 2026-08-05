{{/*
Copyright Broadcom, Inc. All Rights Reserved.
SPDX-License-Identifier: APACHE-2.0
*/}}

{{/* vim: set filetype=mustache: */}}

{{/*
Enable FIPS features
{{ include "common.fips.enabled" . }}
*/}}
{{- define "common.fips.enabled" -}}
    {{- $fips := .Chart.Annotations.fips -}}
    {{- if eq "true" $fips -}}
        {{- true -}}
    {{- end -}}
{{- end -}}

{{/*
Get FIPS environment variable value for the given tech
{{ include "common.fips.config" (dict "tech" "openssl|java|golang" "fips" .Values.fips "global" .Values.global) }}
*/}}
{{- define "common.fips.config" -}}
    {{- $availableTechs := list "openssl" "java" "golang" -}}
    {{- if not (has .tech $availableTechs) -}}
        {{- printf "The common.fips.config method can only provide configuration for: %s" $availableTechs | fail -}}
    {{- end -}}
    {{- $tech := get (.fips) .tech -}}
    {{- $value := $tech | default (.global).defaultFips -}}
    {{- if empty $value -}}
        {{- printf "Please configure a value for 'fips.%s' or 'global.defaultFips'" .tech | fail -}}
    {{- else -}}
        {{- $method := printf "common.fips.%s" .tech -}}
        {{- include $method (dict "value" $value) | trim | print -}}
    {{- end -}}
{{- end -}}

{{/*
Map OpenSSL values for FIPS configuration
{{ include "common.fips.openssl" (dict "value" "restricted") }}
*/}}
{{- define "common.fips.openssl" -}}
    {{- ternary "yes" "no" (eq .value "restricted") | print -}}
{{- end -}}

{{/*
Map JAVA values for FIPS configuration
{{ include "common.fips.java" (dict "value" "restricted") }}
*/}}
{{- define "common.fips.java" -}}
    {{- $suffix := ternary "original" .value (eq .value "off") -}}
    {{- $javaSecurityFile := printf "java.security.%s" $suffix -}}
    {{/* The two equals signs mean the property file will completely override the master properties file */}}
    {{- $javaSecurityOpt := printf "-Djava.security.properties==/opt/bitnami/java/conf/security/%s" $javaSecurityFile -}}
    {{- $bcModulesFlag := "--module-path=/opt/bitnami/bc-fips/" -}}
    {{- $restrictedFlags := printf "%s %s" $bcModulesFlag $javaSecurityOpt -}}

    {{- ternary $restrictedFlags $javaSecurityOpt (eq .value "restricted") | print -}}
{{- end -}}

{{/*
Map Golang values for FIPS configuration
{{ include "common.fips.golang" (dict "value" "restricted") }}
*/}}
{{- define "common.fips.golang" -}}
    {{- if eq .value "restricted" -}}
      {{- print "fips140=only" -}}
    {{- else if eq .value "relaxed" -}}
      {{- print "fips140=on" -}}
    {{- else -}}
      {{- print "fips140=off" -}}
    {{- end -}}
{{- end -}}
