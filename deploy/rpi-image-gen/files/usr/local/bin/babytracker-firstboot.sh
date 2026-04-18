#!/bin/bash
# BabyTracker first boot setup for Raspberry Pi.
# Calls shared provisioning scripts with Pi-specific settings,
# then performs Pi-only steps (hostname, setup-mode firewall).
set -euo pipefail
exec > >(tee -a /var/log/babytracker-firstboot.log) 2>&1

echo "=== BabyTracker First Boot Setup (Raspberry Pi) ==="
echo "Date: $(date)"

COMMON_DIR="/usr/lib/babytracker/common"

# --- Shared setup with Pi-specific tuning ---

# TLS: include the AP IP in the SAN
export BT_TLS_SAN="DNS:babytracker.local,DNS:babytracker,IP:192.168.4.1"
"${COMMON_DIR}/setup-tls.sh"

# PostgreSQL: low-memory tuning for Pi Zero 2W (512MB)
export BT_PG_SHARED_BUFFERS="32MB"
export BT_PG_WORK_MEM="2MB"
export BT_PG_MAINT_WORK_MEM="32MB"
export BT_PG_CACHE_SIZE="128MB"
export BT_PG_MAX_CONN="20"
"${COMMON_DIR}/setup-postgres.sh"

# --- Pi-only steps ---

# Set hostname
echo "[firstboot] Setting hostname to babytracker..."
hostnamectl set-hostname babytracker
sed -i 's/127\.0\.1\.1.*/127.0.1.1\tbabytracker/' /etc/hosts || true

# Configure UFW with setup-mode rules (includes captive portal ports).
# Production rules are applied later by setup-wifi.sh after Wi-Fi is configured.
if ! ufw status | grep -q "Status: active"; then
    echo "[firstboot] Configuring firewall (setup mode)..."
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 53/udp comment "DNS captive portal"
    ufw allow 67/udp comment "DHCP captive portal"
    ufw allow 80/tcp comment "HTTP captive portal"
    ufw allow 443/tcp comment "BabyTracker HTTPS"
    ufw allow 443/tcp comment "BabyTracker ACME"
    ufw --force enable
fi

echo "=== First boot setup complete ==="
