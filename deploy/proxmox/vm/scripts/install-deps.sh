#!/bin/bash
# Install BabyTracker dependencies on a Debian 13 VM.
set -euo pipefail

echo "[install-deps] Installing packages..."
apt-get update
apt-get install -y --no-install-recommends \
    postgresql \
    postgresql-client \
    ufw \
    openssl \
    ssl-cert \
    avahi-daemon \
    avahi-utils \
    unattended-upgrades \
    apt-listchanges \
    sudo \
    ca-certificates
apt-get clean
