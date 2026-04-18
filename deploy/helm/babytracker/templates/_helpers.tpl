{{/*
Expand the name of the chart.
*/}}
{{- define "babytracker.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "babytracker.fullname" -}}
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
Create chart name and version as used by the chart label.
*/}}
{{- define "babytracker.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "babytracker.labels" -}}
helm.sh/chart: {{ include "babytracker.chart" . }}
{{ include "babytracker.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "babytracker.selectorLabels" -}}
app.kubernetes.io/name: {{ include "babytracker.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
PostgreSQL service/hostname
*/}}
{{- define "babytracker.postgresHost" -}}
{{- printf "%s-postgres" (include "babytracker.fullname" .) }}
{{- end }}

{{/*
DATABASE_URL: either user-provided external URL or built from bundled Postgres.
*/}}
{{- define "babytracker.databaseUrl" -}}
{{- if .Values.postgresql.enabled -}}
postgres://{{ .Values.postgresql.username }}:$(POSTGRES_PASSWORD)@{{ include "babytracker.postgresHost" . }}:5432/{{ .Values.postgresql.database }}?sslmode=disable
{{- else -}}
{{ .Values.secrets.databaseUrl }}
{{- end -}}
{{- end }}
