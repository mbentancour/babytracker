# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.26-alpine AS go-builder
# VERSION is injected into the binary for the Settings → Server → Updates
# display. Set it from CI, docker-compose build args, or HA add-on build.
ARG VERSION=dev
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Copy built frontend into the static embed directory
COPY --from=frontend-builder /app/frontend/dist/ /app/internal/router/static/
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w -X 'github.com/mbentancour/babytracker/internal/version.Version=${VERSION}'" \
    -o /babytracker ./cmd/babytracker/

# Stage 3: Runtime
FROM alpine:3.22
# pg_dump + psql are used by the backup/restore code. Alpine's stable repos
# don't yet ship PG 18 client, so we use 17 — the backup/restore code filters
# incompatible SET statements, so a 17 client against an 18 server works.
RUN apk add --no-cache ca-certificates tzdata postgresql17-client && \
    adduser -D -h /var/lib/babytracker babytracker
USER babytracker
WORKDIR /var/lib/babytracker
COPY --from=go-builder /babytracker /usr/local/bin/babytracker
EXPOSE 443
ENTRYPOINT ["babytracker"]
