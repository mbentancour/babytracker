#!/usr/bin/with-contenv bashio

# Read configuration from HA add-on options
MODE=$(bashio::config 'mode')
EXTERNAL_URL=$(bashio::config 'external_url')
UNIT_SYSTEM=$(bashio::config 'unit_system')
BACKUP_FREQUENCY=$(bashio::config 'backup_frequency')
DEMO_MODE=$(bashio::config 'demo_mode')

export UNIT_SYSTEM
export BACKUP_FREQUENCY
export DEMO_MODE
export DATA_DIR="/data/babytracker"
export PORT=8099

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
    bashio::log.info "Proxying to: ${EXTERNAL_URL}"

    export BABYTRACKER_PROXY_URL="${EXTERNAL_URL}"
    exec /usr/local/bin/babytracker

else
    ##############################################
    # STANDALONE MODE: local PostgreSQL + app
    ##############################################
    bashio::log.info "Starting BabyTracker in standalone mode"

    # Initialize PostgreSQL if needed
    if [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then
        bashio::log.info "Initializing PostgreSQL database..."
        su postgres -c "initdb -D /var/lib/postgresql/data --auth=trust --no-locale --encoding=UTF8"
    fi

    # Start PostgreSQL
    bashio::log.info "Starting PostgreSQL..."
    su postgres -c "pg_ctl start -D /var/lib/postgresql/data -l /var/lib/postgresql/data/postgresql.log -o '-k /run/postgresql'"

    # Wait for PostgreSQL
    for i in $(seq 1 30); do
        if su postgres -c "pg_isready -h /run/postgresql" > /dev/null 2>&1; then
            break
        fi
        sleep 1
    done

    # Create database if it doesn't exist
    if ! su postgres -c "psql -h /run/postgresql -lqt" | cut -d \| -f 1 | grep -qw babytracker; then
        bashio::log.info "Creating babytracker database..."
        su postgres -c "createdb -h /run/postgresql babytracker"
    fi

    export DATABASE_URL="postgres://postgres@/babytracker?host=/run/postgresql&sslmode=disable"

    bashio::log.info "Starting BabyTracker server..."
    exec /usr/local/bin/babytracker
fi
