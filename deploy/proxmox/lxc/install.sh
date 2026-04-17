#!/bin/bash
# One-liner install script for BabyTracker on Proxmox LXC.
# Run on your Proxmox host:
#   bash <(curl -fsSL https://raw.githubusercontent.com/<owner>/babytracker/main/deploy/proxmox/lxc/install.sh)
#
# Environment variables (all optional):
#   BT_VMID       Container ID (default: next available)
#   BT_STORAGE    Storage pool (default: local-lvm)
#   BT_BRIDGE     Network bridge (default: vmbr0)
#   BT_MEMORY     Memory in MB (default: 1024)
#   BT_CORES      CPU cores (default: 2)
#   BT_DISK       Disk size (default: 4)
#   BT_VERSION    Release tag to download (default: latest)
set -euo pipefail

STORAGE="${BT_STORAGE:-local-lvm}"
BRIDGE="${BT_BRIDGE:-vmbr0}"
MEMORY="${BT_MEMORY:-1024}"
CORES="${BT_CORES:-2}"
DISK="${BT_DISK:-4}"
VERSION="${BT_VERSION:-latest}"
TEMPLATE_DIR="/var/lib/vz/template/cache"
TEMPLATE_NAME="babytracker-lxc-amd64.tar.zst"
REPO="mbentancour/babytracker"

echo "=== BabyTracker LXC Installer ==="

# Resolve VMID
if [ -n "${BT_VMID:-}" ]; then
    VMID="${BT_VMID}"
else
    VMID=$(pvesh get /cluster/nextid)
    echo "Using next available VMID: ${VMID}"
fi

# Download template
if [ "${VERSION}" = "latest" ]; then
    URL="https://github.com/${REPO}/releases/latest/download/${TEMPLATE_NAME}"
else
    URL="https://github.com/${REPO}/releases/download/${VERSION}/${TEMPLATE_NAME}"
fi

echo "Downloading template..."
wget -q --show-progress -O "${TEMPLATE_DIR}/${TEMPLATE_NAME}" "${URL}"

# Create container
echo "Creating container ${VMID}..."
pct create "${VMID}" "local:vztmpl/${TEMPLATE_NAME}" \
    --hostname babytracker \
    --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp" \
    --memory "${MEMORY}" \
    --cores "${CORES}" \
    --rootfs "${STORAGE}:${DISK}" \
    --unprivileged 1 \
    --features nesting=1

# Start container
echo "Starting container..."
pct start "${VMID}"

# Wait for network and firstboot
echo "Waiting for first boot to complete (this may take up to 60 seconds)..."
for i in $(seq 1 60); do
    if pct exec "${VMID}" -- systemctl is-active babytracker.service &>/dev/null; then
        break
    fi
    sleep 1
done

# Get IP address
IP=$(pct exec "${VMID}" -- /bin/bash -c "awk '/32 host/ { print f } {f=\$2}' /proc/net/fib_trie | sort -u | grep -v 127.0.0.1" 2>/dev/null | head -1)

echo ""
echo "=== BabyTracker is running ==="
echo "  Container ID: ${VMID}"
if [ -n "${IP}" ]; then
    echo "  URL:          https://${IP}:8099"
else
    echo "  URL:          https://<container-ip>:8099"
    echo "  (Could not detect IP — check: pct exec ${VMID} -- cat /proc/net/fib_trie)"
fi
