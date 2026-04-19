#!/bin/bash
# Conditionally bring up the captive portal AP. If the device already has a
# usable network (typically via Ethernet), the AP is skipped — the user can
# reach the setup wizard directly via babytracker.local on the LAN.
#
# Called by babytracker-setup-ap.service as ExecStartPre with root privileges.
set -uo pipefail
exec >> /var/log/babytracker-firstboot.log 2>&1

echo "[ap-check] Looking for existing network connection..."
if ip=$(/usr/local/bin/babytracker-network-check.sh 15); then
    echo "[ap-check] Network already available at ${ip} — skipping AP."
    # Marker so ExecStopPost knows not to tear down the AP it didn't bring up
    touch /run/babytracker-ap-skipped
    exit 0
fi

echo "[ap-check] No existing network — bringing up captive portal AP."
rm -f /run/babytracker-ap-skipped

# Bring up wlan0 with the AP IP and start hostapd + dnsmasq
ip addr add 192.168.4.1/24 dev wlan0 2>/dev/null || true
systemctl start hostapd
systemctl start dnsmasq
