#!/bin/bash
# Called by the BabyTracker Go binary to finalize setup using ethernet.
# Usage:
#   setup-ethernet.sh dhcp
#   setup-ethernet.sh static <addr/cidr> <gateway> [dns,csv]
# Must be run as root (via sudoers entry for babytracker user).
set -euo pipefail
exec >> /var/log/babytracker-setup.log 2>&1

MODE="${1:?mode required: dhcp|static}"

echo "=== Ethernet Setup: $(date) ==="
echo "Mode: ${MODE}"

# Find the wired connection name (typically "Wired connection 1")
ETH_CONN=$(nmcli -t -f NAME,TYPE connection show | awk -F: '$2=="802-3-ethernet"{print $1; exit}')
if [ -z "${ETH_CONN}" ]; then
    echo "No wired connection found"
    exit 1
fi
echo "Wired connection: ${ETH_CONN}"

case "${MODE}" in
    dhcp)
        nmcli connection modify "${ETH_CONN}" \
            ipv4.method auto \
            ipv4.addresses "" \
            ipv4.gateway "" \
            ipv4.dns ""
        ;;
    static)
        ADDR="${2:?address required}"
        GATEWAY="${3:?gateway required}"
        DNS="${4:-1.1.1.1,8.8.8.8}"
        nmcli connection modify "${ETH_CONN}" \
            ipv4.method manual \
            ipv4.addresses "${ADDR}" \
            ipv4.gateway "${GATEWAY}" \
            ipv4.dns "${DNS}"
        ;;
    *)
        echo "Unknown mode: ${MODE}"
        exit 1
        ;;
esac

# Reapply the connection
nmcli connection up "${ETH_CONN}"

# Stop AP infrastructure. We deliberately do NOT call
# `systemctl stop babytracker-setup-ap.service` here — this script runs as a
# child of that service, so stopping it would kill ourselves.
systemctl stop hostapd dnsmasq 2>/dev/null || true
ip addr del 192.168.4.1/24 dev wlan0 2>/dev/null || true

# Remove the setup flag
rm -f /var/lib/babytracker/.needs-setup

# Apply production firewall rules
echo "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 443/tcp comment "BabyTracker HTTPS"
ufw allow 80/tcp comment "BabyTracker HTTP redirect"
ufw --force enable

# Disable setup services so they don't run on next boot
systemctl daemon-reload
systemctl disable babytracker-firstboot.service || true
systemctl disable babytracker-setup-ap.service || true
systemctl enable babytracker.service

# Trigger the swap from setup-ap → babytracker.service in a detached job
# (see the same logic in babytracker-setup-wifi.sh for why).
systemd-run --no-block --collect --unit=babytracker-handover \
    /bin/sh -c "sleep 2 && systemctl stop babytracker-setup-ap.service && systemctl start babytracker.service"

echo "=== Ethernet setup complete ==="
