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

# If media path is configured, set the full path to HA's media directory
if [ -n "${MEDIA_SCAN_PATH}" ]; then
    export MEDIA_PATH="/media/${MEDIA_SCAN_PATH}"
    bashio::log.info "Media scan path: ${MEDIA_PATH}"
fi

# All persistent data goes in /data/ which HA maps as a persistent volume
PG_DATA="/data/postgresql"

mkdir -p "${DATA_DIR}/photos" "${DATA_DIR}/backups"

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
    # LOCAL MODE: SQLite (default) or PostgreSQL
    ##############################################

    # Check if user explicitly wants PostgreSQL via add-on config or env.
    # If DATABASE_URL is set to a postgres:// URL (via HA add-on options or
    # environment), use Postgres. Otherwise default to SQLite.
    DB_URL=$(bashio::config 'database_url' 2>/dev/null || echo "")

    if echo "${DB_URL}" | grep -qi "^postgres"; then
        ################################################
        # POSTGRES MODE (legacy / explicit opt-in)
        ################################################
        bashio::log.info "Starting BabyTracker with PostgreSQL"

        mkdir -p "${PG_DATA}" /run/postgresql
        chown -R postgres:postgres "${PG_DATA}" /run/postgresql

        if [ ! -f "${PG_DATA}/PG_VERSION" ]; then
            bashio::log.info "Initializing PostgreSQL database..."
            su postgres -c "initdb -D ${PG_DATA} --auth=trust --no-locale --encoding=UTF8"
        fi

        bashio::log.info "Starting PostgreSQL..."
        su postgres -c "pg_ctl start -D ${PG_DATA} -l ${PG_DATA}/postgresql.log -o '-k /run/postgresql'"

        for i in $(seq 1 30); do
            if su postgres -c "pg_isready -h /run/postgresql" > /dev/null 2>&1; then
                break
            fi
            sleep 1
        done

        su postgres -c "createdb -h /run/postgresql babytracker" 2>/dev/null || true

        export DATABASE_URL="${DB_URL:-postgres://postgres@/babytracker?host=/run/postgresql&sslmode=disable}"

    else
        ################################################
        # SQLITE MODE (default — no Postgres needed)
        ################################################
        bashio::log.info "Starting BabyTracker with SQLite"
        export DATABASE_URL="${DATA_DIR}/babytracker.db"

        # If there's a legacy Postgres install but no SQLite DB yet,
        # log instructions so the user knows how to migrate.
        if [ -f "${PG_DATA}/PG_VERSION" ] && [ ! -f "${DATA_DIR}/babytracker.db" ]; then
            bashio::log.warning "Found an existing PostgreSQL database at ${PG_DATA}."
            bashio::log.warning "The add-on now defaults to SQLite. Your Postgres data is untouched."
            bashio::log.warning "To migrate: set database_url to 'postgres://postgres@/babytracker?host=/run/postgresql&sslmode=disable'"
            bashio::log.warning "in the add-on configuration, then use the migrate-db tool."
        fi
    fi

    bashio::log.info "Starting BabyTracker server..."
    exec /usr/local/bin/babytracker
fi
