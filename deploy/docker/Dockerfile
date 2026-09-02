# Stage 1: Build frontend
# Pinned to BUILDPLATFORM: the output is plain JS/CSS/HTML with no architecture
# of its own, so running npm under QEMU once per target arch was pure waste.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Go binary
# Also pinned to BUILDPLATFORM and cross-compiled via GOOS/GOARCH - with
# CGO_ENABLED=0 Go cross-compiles natively, so this needs no emulation either.
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS go-builder
# VERSION is injected into the binary for the Settings → Server → Updates
# display. Set it from CI, docker-compose build args, or HA add-on build.
ARG VERSION=dev
ARG TARGETOS
ARG TARGETARCH
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Copy built frontend into the static embed directory
COPY --from=frontend-builder /app/frontend/dist/ /app/internal/router/static/
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath \
    -ldflags="-s -w -X 'github.com/mbentancour/babytracker/internal/version.Version=${VERSION}'" \
    -o /babytracker ./cmd/babytracker/

# Stage 3: Runtime
FROM alpine:3.24
# pg_dump + psql are used by the backup/restore code.
# Alpine 3.24 includes postgresql18-client.
RUN apk add --no-cache ca-certificates tzdata postgresql18-client && \
    adduser -D -h /var/lib/babytracker babytracker
USER babytracker
WORKDIR /var/lib/babytracker
COPY --from=go-builder /babytracker /usr/local/bin/babytracker
EXPOSE 443
ENTRYPOINT ["babytracker"]
