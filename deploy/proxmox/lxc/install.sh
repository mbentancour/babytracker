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

echo "Downloading template from ${URL}..."
if ! wget -q --show-progress -O "${TEMPLATE_DIR}/${TEMPLATE_NAME}" "${URL}"; then
    echo "ERROR: Download failed. Check that a release exists at:"
    echo "  https://github.com/${REPO}/releases"
    echo ""
    echo "Alternatively, build the template locally and copy it to:"
    echo "  ${TEMPLATE_DIR}/${TEMPLATE_NAME}"
    rm -f "${TEMPLATE_DIR}/${TEMPLATE_NAME}"
    exit 1
fi

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
    echo "  URL:          https://${IP}"
else
    echo "  URL:          https://<container-ip>"
    echo "  (Could not detect IP — check: pct exec ${VMID} -- cat /proc/net/fib_trie)"
fi

# --- Optional TLS certificate setup ---
# Skip if non-interactive or BT_TLS_PROVIDER is pre-set
setup_tls() {
    local TLS_PROVIDER="${BT_TLS_PROVIDER:-}"
    local TLS_DOMAIN="${BT_TLS_DOMAIN:-}"
    local TLS_EMAIL="${BT_TLS_EMAIL:-}"

    if [ -z "${TLS_PROVIDER}" ]; then
        # Interactive mode
        echo ""
        read -rp "Would you like to set up a valid TLS certificate? (y/N) " REPLY
        if [[ ! "${REPLY}" =~ ^[Yy]$ ]]; then
            return
        fi

        echo ""
        echo "Select a DNS provider:"
        echo "  1) Cloudflare"
        echo "  2) AWS Route53"
        echo "  3) DuckDNS"
        echo "  4) Namecheap"
        echo "  5) Simply.com"
        read -rp "Choice (1-5): " CHOICE
        case "${CHOICE}" in
            1) TLS_PROVIDER="cloudflare" ;;
            2) TLS_PROVIDER="route53" ;;
            3) TLS_PROVIDER="duckdns" ;;
            4) TLS_PROVIDER="namecheap" ;;
            5) TLS_PROVIDER="simply" ;;
            *) echo "Invalid choice."; return ;;
        esac

        read -rp "Domain (e.g. baby.example.com): " TLS_DOMAIN
        if [ -z "${TLS_DOMAIN}" ]; then
            echo "Domain is required."
            return
        fi

        read -rp "Email for Let's Encrypt notifications [admin@${TLS_DOMAIN}]: " TLS_EMAIL
        TLS_EMAIL="${TLS_EMAIL:-admin@${TLS_DOMAIN}}"
    fi

    # Collect provider-specific credentials
    local ENV_LINES="TLS_DOMAIN=${TLS_DOMAIN}
ACME_DNS_PROVIDER=${TLS_PROVIDER}
ACME_EMAIL=${TLS_EMAIL}"

    case "${TLS_PROVIDER}" in
        cloudflare)
            local TOKEN="${CF_DNS_API_TOKEN:-}"
            if [ -z "${TOKEN}" ]; then
                read -rsp "Cloudflare API Token: " TOKEN; echo
            fi
            ENV_LINES="${ENV_LINES}
CF_DNS_API_TOKEN=${TOKEN}"
            ;;
        route53)
            local KEY_ID="${AWS_ACCESS_KEY_ID:-}"
            local SECRET="${AWS_SECRET_ACCESS_KEY:-}"
            if [ -z "${KEY_ID}" ]; then
                read -rp "AWS Access Key ID: " KEY_ID
                read -rsp "AWS Secret Access Key: " SECRET; echo
            fi
            ENV_LINES="${ENV_LINES}
AWS_ACCESS_KEY_ID=${KEY_ID}
AWS_SECRET_ACCESS_KEY=${SECRET}"
            if [ -n "${AWS_HOSTED_ZONE_ID:-}" ]; then
                ENV_LINES="${ENV_LINES}
AWS_HOSTED_ZONE_ID=${AWS_HOSTED_ZONE_ID}"
            fi
            ;;
        duckdns)
            local TOKEN="${DUCKDNS_TOKEN:-}"
            if [ -z "${TOKEN}" ]; then
                read -rsp "DuckDNS Token: " TOKEN; echo
            fi
            ENV_LINES="${ENV_LINES}
DUCKDNS_TOKEN=${TOKEN}"
            ;;
        namecheap)
            local USER="${NAMECHEAP_API_USER:-}"
            local KEY="${NAMECHEAP_API_KEY:-}"
            if [ -z "${USER}" ]; then
                read -rp "Namecheap API User: " USER
                read -rsp "Namecheap API Key: " KEY; echo
            fi
            ENV_LINES="${ENV_LINES}
NAMECHEAP_API_USER=${USER}
NAMECHEAP_API_KEY=${KEY}"
            ;;
        simply)
            local ACCT="${SIMPLY_ACCOUNT_NAME:-}"
            local KEY="${SIMPLY_API_KEY:-}"
            if [ -z "${ACCT}" ]; then
                read -rp "Simply.com Account Name: " ACCT
                read -rsp "Simply.com API Key: " KEY; echo
            fi
            ENV_LINES="${ENV_LINES}
SIMPLY_ACCOUNT_NAME=${ACCT}
SIMPLY_API_KEY=${KEY}"
            ;;
    esac

    echo ""
    echo "Configuring TLS certificate for ${TLS_DOMAIN}..."

    # Remove self-signed cert config and append ACME config
    pct exec "${VMID}" -- /bin/bash -c "
        sed -i '/^TLS_CERT=/d; /^TLS_KEY=/d' /etc/babytracker/babytracker.env
        cat >> /etc/babytracker/babytracker.env << 'ENVEOF'
${ENV_LINES}
ENVEOF
    "

    # Restart the service to pick up the new config
    pct exec "${VMID}" -- systemctl restart babytracker

    echo "Waiting for certificate (this may take up to 2 minutes)..."
    for i in $(seq 1 120); do
        if pct exec "${VMID}" -- test -f /var/lib/babytracker/certs/cert.pem 2>/dev/null; then
            echo "TLS certificate obtained!"
            echo "  URL: https://${TLS_DOMAIN}"
            echo "  (Make sure ${TLS_DOMAIN} resolves to ${IP:-the container IP})"
            return
        fi
        sleep 1
    done
    echo "Certificate not yet available. Check logs:"
    echo "  pct exec ${VMID} -- journalctl -u babytracker -n 50"
}

# Run TLS setup if interactive terminal or BT_TLS_PROVIDER is set
if [ -t 0 ] || [ -n "${BT_TLS_PROVIDER:-}" ]; then
    setup_tls
fi
