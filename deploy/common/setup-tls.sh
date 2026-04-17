#!/bin/bash
# Generate a self-signed TLS certificate for BabyTracker.
# Idempotent — skips if cert already exists.
#
# Environment variables:
#   BT_TLS_CN   Common Name (default: babytracker.local)
#   BT_TLS_SAN  Subject Alt Names (default: DNS:babytracker.local,DNS:babytracker)
set -euo pipefail

TLS_CN="${BT_TLS_CN:-babytracker.local}"
TLS_SAN="${BT_TLS_SAN:-DNS:babytracker.local,DNS:babytracker}"

CERT="/etc/ssl/certs/babytracker.crt"
KEY="/etc/ssl/private/babytracker.key"

if [ -f "${CERT}" ]; then
    echo "[setup-tls] Certificate already exists at ${CERT}, skipping."
    exit 0
fi

echo "[setup-tls] Generating self-signed certificate (CN=${TLS_CN})..."
openssl req -x509 -nodes -days 3650 \
    -newkey rsa:2048 \
    -keyout "${KEY}" \
    -out "${CERT}" \
    -subj "/CN=${TLS_CN}" \
    -addext "subjectAltName=${TLS_SAN}"

chmod 640 "${KEY}"
chgrp ssl-cert "${KEY}"

# babytracker user needs ssl-cert membership to read the key
usermod -aG ssl-cert babytracker

echo "[setup-tls] Certificate generated."
