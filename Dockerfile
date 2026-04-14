ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install runtime dependencies and build tools
RUN apk add --no-cache \
    postgresql17 \
    postgresql17-client \
    ca-certificates \
    tzdata \
    bash \
    nodejs \
    npm \
    wget

# Install Go from official tarball (Alpine's packaged version is too old)
RUN ARCH=$(uname -m) && \
    case "${ARCH}" in \
      x86_64) GOARCH=amd64 ;; \
      aarch64) GOARCH=arm64 ;; \
      armv7l) GOARCH=armv6l ;; \
      i686|i386) GOARCH=386 ;; \
      *) GOARCH=amd64 ;; \
    esac && \
    wget -q "https://go.dev/dl/go1.25.0.linux-${GOARCH}.tar.gz" -O /tmp/go.tar.gz && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm /tmp/go.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"

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
RUN rm -rf /usr/local/go /tmp/frontend /tmp/build /root/go /root/.cache && \
    apk del nodejs npm wget

# Setup PostgreSQL data directory
RUN mkdir -p /run/postgresql /var/lib/postgresql/data && \
    chown -R postgres:postgres /run/postgresql /var/lib/postgresql

# Copy run script
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
