#!/bin/bash
# BabyTracker installation script — shared across all deployment targets.
# Idempotent — safe to run multiple times.
#
# Prerequisites:
#   - Debian/Ubuntu with systemd
#   - Binary at /usr/local/bin/babytracker (placed before running this script)
#   - Packages already installed: postgresql, ufw, openssl, ssl-cert,
#     avahi-daemon, unattended-upgrades, sudo
#
# Environment variables (all optional, passed through to sub-scripts):
#   BT_PG_VERSION, BT_PG_SHARED_BUFFERS, BT_PG_WORK_MEM, etc.
#   BT_TLS_CN, BT_TLS_SAN
#
# This script is called by:
#   - deploy/proxmox/lxc/build-lxc-template.sh (inside chroot)
#   - deploy/proxmox/vm/vm.pkr.hcl (via SSH provisioner)
#   - deploy/rpi-image-gen (indirectly, via firstboot.sh at runtime)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== BabyTracker Install ==="

# 1. Create system user
if ! id -u babytracker &>/dev/null; then
    echo "[install] Creating babytracker system user..."
    useradd --system --no-create-home --shell /usr/sbin/nologin babytracker
fi

# 2. Create data directory
echo "[install] Setting up data directory..."
install -d -m 750 -o babytracker -g babytracker /var/lib/babytracker

# 3. Install config files from common/files/ if available
if [ -d "${SCRIPT_DIR}/files" ]; then
    echo "[install] Installing config files..."
    cp -a "${SCRIPT_DIR}/files/." /

    # Fix permissions on env file
    chown root:babytracker /etc/babytracker/babytracker.env
    chmod 640 /etc/babytracker/babytracker.env
fi

# 4. Set up PostgreSQL
"${SCRIPT_DIR}/setup-postgres.sh"

# 5. Set up TLS
"${SCRIPT_DIR}/setup-tls.sh"

# 6. Set up firewall
"${SCRIPT_DIR}/setup-ufw.sh"

# 7. Enable services
echo "[install] Enabling services..."
systemctl daemon-reload
systemctl enable postgresql
systemctl enable avahi-daemon
systemctl enable babytracker.service

echo "=== BabyTracker Install Complete ==="
