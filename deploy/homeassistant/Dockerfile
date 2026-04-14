ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install PostgreSQL and required tools
RUN apk add --no-cache \
    postgresql17 \
    postgresql17-client \
    nodejs \
    npm \
    go \
    ca-certificates \
    tzdata \
    bash

# Build frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --production=false
COPY frontend/ ./
RUN npm run build

# Build Go binary
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN cp -r /build/frontend/dist/ /build/internal/router/static/ && \
    CGO_ENABLED=0 go build -o /usr/local/bin/babytracker ./cmd/babytracker/

# Clean up build tools
RUN apk del go nodejs npm && \
    rm -rf /build /root/go /root/.cache /tmp/*

# Setup PostgreSQL data directory
RUN mkdir -p /run/postgresql /var/lib/postgresql/data && \
    chown -R postgres:postgres /run/postgresql /var/lib/postgresql

# Copy run script
COPY deploy/homeassistant/run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
