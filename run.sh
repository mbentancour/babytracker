#!/usr/bin/with-contenv bashio

# Read configuration from HA add-on options
MODE=$(bashio::config 'mode')
EXTERNAL_URL=$(bashio::config 'external_url')
UNIT_SYSTEM=$(bashio::config 'unit_system')
BACKUP_FREQUENCY=$(bashio::config 'backup_frequency')
DEMO_MODE=$(bashio::config 'demo_mode')

MEDIA_SCAN_PATH=$(bashio::config 'media_path')

export UNIT_SYSTEM
export BACKUP_FREQUENCY
export DEMO_MODE
export DATA_DIR="/data/babytracker"
export PORT=8099
export TLS_ENABLED=false

# If media path is configured, set the full path to HA's media directory
if [ -n "${MEDIA_SCAN_PATH}" ]; then
    export MEDIA_PATH="/media/${MEDIA_SCAN_PATH}"
    bashio::log.info "Media scan path: ${MEDIA_PATH}"
fi

# All persistent data goes in /data/ which HA maps as a persistent volume
PG_DATA="/data/postgresql"

mkdir -p "${DATA_DIR}/photos" "${DATA_DIR}/backups" "${PG_DATA}" /run/postgresql
chown -R postgres:postgres "${PG_DATA}" /run/postgresql

if [ "${MODE}" = "external" ]; then
    ##############################################
    # EXTERNAL MODE: proxy to remote BabyTracker
    ##############################################
    if [ -z "${EXTERNAL_URL}" ]; then
        bashio::log.error "External mode requires 'external_url' to be set"
        exit 1
    fi

    bashio::log.info "Starting BabyTracker in external mode"
    # Strip user:pass@ from URL before logging so embedded credentials don't
    # leak into HA logs.
    REDACTED_URL=$(echo "${EXTERNAL_URL}" | sed -E 's|(://)[^@/]+@|\1***@|')
    bashio::log.info "Proxying to: ${REDACTED_URL}"

    export BABYTRACKER_PROXY_URL="${EXTERNAL_URL}"
    exec /usr/local/bin/babytracker

else
    ##############################################
    # LOCAL MODE: built-in PostgreSQL + app
    ##############################################
    bashio::log.info "Starting BabyTracker in local mode"

    # Initialize PostgreSQL if needed
    if [ ! -f "${PG_DATA}/PG_VERSION" ]; then
        bashio::log.info "Initializing PostgreSQL database..."
        su postgres -c "initdb -D ${PG_DATA} --auth=trust --no-locale --encoding=UTF8"
    fi

    # Start PostgreSQL
    bashio::log.info "Starting PostgreSQL..."
    su postgres -c "pg_ctl start -D ${PG_DATA} -l ${PG_DATA}/postgresql.log -o '-k /run/postgresql'"

    # Wait for PostgreSQL
    for i in $(seq 1 30); do
        if su postgres -c "pg_isready -h /run/postgresql" > /dev/null 2>&1; then
            break
        fi
        sleep 1
    done

    # Create database if it doesn't exist (ignore error if it already exists)
    su postgres -c "createdb -h /run/postgresql babytracker" 2>/dev/null || true

    export DATABASE_URL="postgres://postgres@/babytracker?host=/run/postgresql&sslmode=disable"

    bashio::log.info "Starting BabyTracker server..."
    exec /usr/local/bin/babytracker
fi
