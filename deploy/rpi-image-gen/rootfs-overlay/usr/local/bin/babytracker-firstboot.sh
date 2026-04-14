#!/bin/bash
set -euo pipefail
exec > >(tee -a /var/log/babytracker-firstboot.log) 2>&1

echo "=== BabyTracker First Boot Setup ==="
echo "Date: $(date)"

# 1. Generate self-signed TLS certificate
if [ ! -f /etc/ssl/certs/babytracker.crt ]; then
    echo "Generating TLS certificate..."
    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout /etc/ssl/private/babytracker.key \
        -out /etc/ssl/certs/babytracker.crt \
        -subj "/CN=babytracker.local" \
        -addext "subjectAltName=DNS:babytracker.local,DNS:babytracker,IP:192.168.4.1"
    chmod 640 /etc/ssl/private/babytracker.key
    chgrp babytracker /etc/ssl/private/babytracker.key
    echo "TLS certificate generated."
fi

# 2. Initialize PostgreSQL
PG_CLUSTER="17/main"
PG_DATA="/var/lib/postgresql/${PG_CLUSTER}"

if [ ! -f "${PG_DATA}/PG_VERSION" ]; then
    echo "Initializing PostgreSQL cluster..."
    pg_ctlcluster 17 main start || true
    sleep 2
    su - postgres -c "createuser --no-password babytracker" 2>/dev/null || true
    su - postgres -c "createdb --owner=babytracker babytracker" 2>/dev/null || true
else
    echo "Starting existing PostgreSQL cluster..."
    pg_ctlcluster 17 main start || true
fi

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
    if pg_isready -q 2>/dev/null; then
        echo "PostgreSQL is ready."
        break
    fi
    sleep 1
done

# 3. Tune PostgreSQL for low memory (Pi Zero 2W has 512MB)
PG_CONF="/etc/postgresql/17/main/postgresql.conf"
if [ -f "${PG_CONF}" ] && ! grep -q "# BabyTracker tuning" "${PG_CONF}"; then
    echo "Tuning PostgreSQL for low memory..."
    cat >> "${PG_CONF}" << 'PGEOF'

# BabyTracker tuning for Raspberry Pi
shared_buffers = 32MB
work_mem = 2MB
maintenance_work_mem = 32MB
effective_cache_size = 128MB
max_connections = 20
PGEOF
    pg_ctlcluster 17 main reload || true
fi

# 4. Set hostname
echo "Setting hostname to babytracker..."
hostnamectl set-hostname babytracker
sed -i 's/127\.0\.1\.1.*/127.0.1.1\tbabytracker/' /etc/hosts || true

echo "=== First boot setup complete ==="
