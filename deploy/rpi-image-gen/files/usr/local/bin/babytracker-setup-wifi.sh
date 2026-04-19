#!/bin/bash
# Called by the BabyTracker Go binary to connect to Wi-Fi and complete setup.
# Usage: setup-wifi.sh <SSID> <PASSWORD>
# Must be run as root (via sudoers entry for babytracker user).
set -euo pipefail
exec >> /var/log/babytracker-setup.log 2>&1

SSID="${1:?SSID required}"
PASSWORD="${2:-}"

echo "=== Wi-Fi Setup: $(date) ==="
echo "Connecting to SSID: ${SSID}"

# Stop the setup AP service (this also stops hostapd, dnsmasq, cleans iptables)
systemctl stop babytracker-setup-ap.service || true

# Remove AP static IP
ip addr del 192.168.4.1/24 dev wlan0 2>/dev/null || true

# Hand wlan0 over to NetworkManager (during setup, hostapd owned it)
rm -f /etc/NetworkManager/conf.d/99-babytracker-setup.conf
nmcli general reload || systemctl reload NetworkManager || systemctl restart NetworkManager
sleep 2

# Connect to Wi-Fi using NetworkManager
if [ -n "${PASSWORD}" ]; then
    nmcli dev wifi connect "${SSID}" password "${PASSWORD}" ifname wlan0
else
    nmcli dev wifi connect "${SSID}" ifname wlan0
fi

# Wait for connection
echo "Waiting for network connection..."
for i in $(seq 1 30); do
    if nmcli -t -f STATE general 2>/dev/null | grep -q "connected"; then
        echo "Network connected."
        break
    fi
    sleep 1
done

# Remove the setup flag file
rm -f /var/lib/babytracker/.needs-setup

# Reload systemd so ConditionPathExists is re-evaluated
systemctl daemon-reload

# Disable setup services and enable the main service
systemctl disable babytracker-firstboot.service || true
systemctl disable babytracker-setup-ap.service || true
systemctl enable babytracker.service
systemctl start babytracker.service

# Apply production firewall rules
echo "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 443/tcp comment "BabyTracker HTTPS"
ufw allow 80/tcp comment "BabyTracker HTTP redirect"
ufw --force enable

echo "=== Setup complete ==="
