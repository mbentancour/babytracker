#!/bin/bash
# Initialize PostgreSQL for BabyTracker.
# Idempotent — safe to run multiple times.
#
# Environment variables:
#   BT_PG_VERSION         PostgreSQL major version (default: 17)
#   BT_PG_SHARED_BUFFERS  shared_buffers setting (default: 128MB)
#   BT_PG_WORK_MEM        work_mem setting (default: 4MB)
#   BT_PG_MAINT_WORK_MEM  maintenance_work_mem setting (default: 64MB)
#   BT_PG_CACHE_SIZE      effective_cache_size setting (default: 512MB)
#   BT_PG_MAX_CONN        max_connections setting (default: 100)
set -euo pipefail

PG_VERSION="${BT_PG_VERSION:-17}"
PG_CLUSTER="${PG_VERSION}/main"
PG_DATA="/var/lib/postgresql/${PG_CLUSTER}"
PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"

echo "[setup-postgres] Initializing PostgreSQL ${PG_VERSION}..."

if [ ! -f "${PG_DATA}/PG_VERSION" ]; then
    echo "[setup-postgres] Creating cluster..."
    pg_ctlcluster "${PG_VERSION}" main start || true
    sleep 2
    su - postgres -c "createuser --no-password babytracker" 2>/dev/null || true
    su - postgres -c "createdb --owner=babytracker babytracker" 2>/dev/null || true
else
    echo "[setup-postgres] Starting existing cluster..."
    pg_ctlcluster "${PG_VERSION}" main start || true
fi

echo "[setup-postgres] Waiting for PostgreSQL..."
for i in $(seq 1 30); do
    if pg_isready -q 2>/dev/null; then
        echo "[setup-postgres] PostgreSQL is ready."
        break
    fi
    sleep 1
done

# Ensure user/database exist even if cluster was already initialized
su - postgres -c "createuser --no-password babytracker" 2>/dev/null || true
su - postgres -c "createdb --owner=babytracker babytracker" 2>/dev/null || true

# Apply tuning if not already done
if [ -f "${PG_CONF}" ] && ! grep -q "# BabyTracker tuning" "${PG_CONF}"; then
    echo "[setup-postgres] Applying performance tuning..."
    cat >> "${PG_CONF}" << PGEOF

# BabyTracker tuning
shared_buffers = ${BT_PG_SHARED_BUFFERS:-128MB}
work_mem = ${BT_PG_WORK_MEM:-4MB}
maintenance_work_mem = ${BT_PG_MAINT_WORK_MEM:-64MB}
effective_cache_size = ${BT_PG_CACHE_SIZE:-512MB}
max_connections = ${BT_PG_MAX_CONN:-100}
PGEOF
    pg_ctlcluster "${PG_VERSION}" main reload || true
fi

echo "[setup-postgres] Done."
