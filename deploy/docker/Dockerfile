# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.26-alpine AS go-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Copy built frontend into the static embed directory
COPY --from=frontend-builder /app/frontend/dist/ /app/internal/router/static/
RUN CGO_ENABLED=0 go build -o /babytracker ./cmd/babytracker/

# Stage 3: Runtime
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata && \
    adduser -D -h /var/lib/babytracker babytracker
USER babytracker
WORKDIR /var/lib/babytracker
COPY --from=go-builder /babytracker /usr/local/bin/babytracker
EXPOSE 8099
ENTRYPOINT ["babytracker"]
