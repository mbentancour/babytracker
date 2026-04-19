#!/bin/bash
# Counterpart to babytracker-maybe-start-ap.sh. Tears down hostapd/dnsmasq
# only if we actually brought them up.
set -uo pipefail
exec >> /var/log/babytracker-firstboot.log 2>&1

if [ -f /run/babytracker-ap-skipped ]; then
    rm -f /run/babytracker-ap-skipped
    echo "[ap-stop] AP was skipped, nothing to tear down."
    exit 0
fi

systemctl stop hostapd 2>/dev/null || true
systemctl stop dnsmasq 2>/dev/null || true
ip addr del 192.168.4.1/24 dev wlan0 2>/dev/null || true
