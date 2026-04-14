ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install build tools and runtime dependencies
RUN apk add --no-cache \
    postgresql17 \
    postgresql17-client \
    ca-certificates \
    tzdata \
    bash \
    nodejs \
    npm \
    go

# Build frontend
WORKDIR /tmp/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --production=false
COPY frontend/ ./
RUN npm run build

# Build Go binary
WORKDIR /tmp/build
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY migrations/ ./migrations/
RUN cp -r /tmp/frontend/dist/ ./internal/router/static/ && \
    CGO_ENABLED=0 go build -o /usr/local/bin/babytracker ./cmd/babytracker/

# Clean up build tools and source
RUN apk del go nodejs npm && \
    rm -rf /tmp/frontend /tmp/build /root/go /root/.cache

# Setup PostgreSQL data directory
RUN mkdir -p /run/postgresql /var/lib/postgresql/data && \
    chown -R postgres:postgres /run/postgresql /var/lib/postgresql

# Copy run script
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
