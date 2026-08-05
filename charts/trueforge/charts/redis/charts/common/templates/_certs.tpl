{{/*
Copyright Broadcom, Inc. All Rights Reserved.
SPDX-License-Identifier: APACHE-2.0
*/}}

{{/* vim: set filetype=mustache: */}}

{{/*
Returns a space-separated list of Subject Alternative Names (SANs) to create a TLS certificate
Usage:
{{ include "common.certs.sans" (dict "namespace" "default" "clusterDomain" "cluster.local" "serviceName" "my-service" "headlessServiceName" "my-service-headless" "loopback" true "extraSANs" (list "custom.domain.com")) }}

Params:
  - namespace - String - Required - Namespace where the app which we are generating the certificate for is deployed.
  - clusterDomain - String - Optional - Cluster domain. Default is "cluster.local".
  - serviceName - String - Optional - App service name. If provided, the following SANs will be generated:
      - serviceName.namespace.svc.clusterDomain
      - serviceName.namespace.svc
      - serviceName.namespace
      - serviceName
  - headlessServiceName - String - Optional - App headless service name. If provided, the following wildcard SANs will be generated:
      - *.headlessServiceName.namespace.svc.clusterDomain
      - *.headlessServiceName.namespace.svc
      - *.headlessServiceName.namespace
      - *.headlessServiceName
  - extraSANs - List<String> - Optional - Additional custom SANs to be added.
  - loopback - Boolean - Optional - If true, "localhost" will be added to the SANs.
*/}}
{{- define "common.certs.sans" -}}
{{- $sans := list }}
{{- if .serviceName -}}
    {{- $sans = append $sans (printf "%s.%s.svc.%s" .serviceName .namespace (default "cluster.local" .clusterDomain)) -}}
    {{- $sans = append $sans (printf "%s.%s.svc" .serviceName .namespace) -}}
    {{- $sans = append $sans (printf "%s.%s" .serviceName .namespace) -}}
    {{- $sans = append $sans .serviceName -}}
{{- end -}}
{{- if .headlessServiceName -}}
    {{- /* Include wildcard SANs for headless service */ -}}
    {{- $sans = append $sans (printf "*.%s.%s.svc.%s" .headlessServiceName .namespace (default "cluster.local" .clusterDomain)) -}}
    {{- $sans = append $sans (printf "*.%s.%s.svc" .headlessServiceName .namespace) -}}
    {{- $sans = append $sans (printf "*.%s.%s" .headlessServiceName .namespace) -}}
    {{- $sans = append $sans (printf "*.%s" .headlessServiceName) -}}
{{- end -}}
{{- range .extraSANs }}
    {{- $sans = append $sans . -}}
{{- end -}}
{{- if (default false .loopback) -}}
    {{- $sans = append $sans "localhost" }}
{{- end -}}
{{- join " " $sans | trim -}}
{{- end -}}
