#!/bin/bash
# Called by the BabyTracker Go binary to connect to Wi-Fi and complete setup.
# Usage:
#   setup-wifi.sh <SSID> <PASSWORD>
#   setup-wifi.sh <SSID> <PASSWORD> <addr/cidr> <gateway> [dns,csv]   (static IP)
# Must be run as root (via sudoers entry for babytracker user).
set -euo pipefail
exec >> /var/log/babytracker-setup.log 2>&1

SSID="${1:?SSID required}"
PASSWORD="${2:-}"
STATIC_ADDR="${3:-}"
STATIC_GATEWAY="${4:-}"
STATIC_DNS="${5:-1.1.1.1,8.8.8.8}"

echo "=== Wi-Fi Setup: $(date) ==="
echo "Connecting to SSID: ${SSID}"

# Stop the AP infrastructure. We deliberately do NOT call
# `systemctl stop babytracker-setup-ap.service` here — this script runs as a
# child of that service, so stopping it would kill ourselves before we finish.
# The service will exit normally once .needs-setup is removed and babytracker
# .service takes over via ConditionPathExists.
systemctl stop hostapd dnsmasq 2>/dev/null || true

# Remove AP static IP and bring wlan0 down so it's clean for NM
ip addr del 192.168.4.1/24 dev wlan0 2>/dev/null || true
ip link set wlan0 down 2>/dev/null || true

# Unblock the radio in case hostapd left it soft-blocked
rfkill unblock wlan 2>/dev/null || true
rfkill unblock all 2>/dev/null || true

# Hand wlan0 over to NetworkManager. We need a full restart, not a reload —
# changes in conf.d/ aren't picked up by `nmcli general reload`.
rm -f /etc/NetworkManager/conf.d/99-babytracker-setup.conf
systemctl restart NetworkManager
systemctl start wpa_supplicant 2>/dev/null || true

# Wait for NetworkManager to be ready before issuing nmcli commands
echo "Waiting for NetworkManager to be ready..."
for i in $(seq 1 30); do
    if nmcli general status 2>/dev/null | grep -q connected; then
        break
    fi
    sleep 1
done

# Explicitly mark wlan0 as managed (belt and suspenders — the conf file removal
# above should be enough, but timing can be flaky right after restart)
nmcli device set wlan0 managed yes 2>/dev/null || true
ip link set wlan0 up 2>/dev/null || true

echo "Waiting for wlan0 to become disconnected..."
for i in $(seq 1 30); do
    state=$(nmcli -t -f DEVICE,STATE device status 2>/dev/null | awk -F: '$1=="wlan0"{print $2}')
    echo "  wlan0 state: ${state}"
    if [ "${state}" = "disconnected" ]; then
        break
    fi
    sleep 1
done

# Use the connection-add approach instead of `dev wifi connect` to avoid
# scan-cache timing issues. `connection add` creates a profile that doesn't
# require the SSID to be in the current scan results; `connection up` then
# activates it (NM scans/associates on its own).
CONN_NAME="babytracker-${SSID}"
echo "Creating connection profile ${CONN_NAME}..."
nmcli connection delete "${CONN_NAME}" 2>/dev/null || true

if [ -n "${PASSWORD}" ]; then
    nmcli connection add type wifi \
        con-name "${CONN_NAME}" \
        ifname wlan0 \
        ssid "${SSID}" \
        wifi-sec.key-mgmt wpa-psk \
        wifi-sec.psk "${PASSWORD}"
else
    nmcli connection add type wifi \
        con-name "${CONN_NAME}" \
        ifname wlan0 \
        ssid "${SSID}"
fi

# Trigger a scan so NM has fresh BSS info before activating
nmcli dev wifi rescan ifname wlan0 2>/dev/null || true
sleep 3

echo "Activating connection..."
nmcli connection up "${CONN_NAME}"

# Wait for connection
echo "Waiting for network connection..."
for i in $(seq 1 30); do
    if nmcli -t -f STATE general 2>/dev/null | grep -q "connected"; then
        echo "Network connected."
        break
    fi
    sleep 1
done

# If a static IP was requested, reconfigure the connection we just created
if [ -n "${STATIC_ADDR}" ] && [ -n "${STATIC_GATEWAY}" ]; then
    echo "Applying static IP ${STATIC_ADDR} via ${STATIC_GATEWAY}..."
    nmcli connection modify "${CONN_NAME}" \
        ipv4.method manual \
        ipv4.addresses "${STATIC_ADDR}" \
        ipv4.gateway "${STATIC_GATEWAY}" \
        ipv4.dns "${STATIC_DNS}"
    nmcli connection up "${CONN_NAME}" || true
fi

# Remove the setup flag file
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

# Trigger the swap from setup-ap → babytracker.service in a detached job.
# We can't `systemctl stop babytracker-setup-ap` from here (this script runs
# as a child of that service), and we can't `systemctl start babytracker`
# either because port 443 is still held until setup-ap actually stops.
# A detached transient unit handles both after our script returns.
systemd-run --no-block --collect --unit=babytracker-handover \
    /bin/sh -c "sleep 2 && systemctl stop babytracker-setup-ap.service && systemctl start babytracker.service"

echo "=== Setup complete ==="
