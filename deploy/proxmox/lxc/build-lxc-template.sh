#!/bin/bash
# Build a Proxmox-compatible LXC template for BabyTracker.
#
# Produces a rootfs tarball that can be imported into Proxmox:
#   pct create <vmid> <storage>:vztmpl/babytracker-lxc.tar.zst \
#     --hostname babytracker --net0 name=eth0,bridge=vmbr0,ip=dhcp \
#     --memory 1024 --cores 2 --rootfs <storage>:4 --unprivileged 1
#
# Requirements (host):
#   - Root privileges (debootstrap needs them)
#   - debootstrap, zstd
#   - BabyTracker binary available at $BABYTRACKER_BINARY or downloaded
#
# Environment variables:
#   BABYTRACKER_BINARY    Path to pre-built binary (required)
#   OUTPUT_DIR            Where to write the tarball (default: ./output)
#   ARCH                  Target architecture (default: amd64)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}/../../.."
COMMON_DIR="${REPO_ROOT}/deploy/common"

BABYTRACKER_BINARY="${BABYTRACKER_BINARY:?Set BABYTRACKER_BINARY to the path of the pre-built binary}"
OUTPUT_DIR="${OUTPUT_DIR:-${SCRIPT_DIR}/output}"
ARCH="${ARCH:-amd64}"
ROOTFS="$(mktemp -d)/rootfs"

cleanup() {
    echo "[lxc] Cleaning up..."
    # Unmount any leftover mounts
    umount "${ROOTFS}/proc" 2>/dev/null || true
    umount "${ROOTFS}/sys" 2>/dev/null || true
    umount "${ROOTFS}/dev/pts" 2>/dev/null || true
    umount "${ROOTFS}/dev" 2>/dev/null || true
    rm -rf "${ROOTFS}"
}
trap cleanup EXIT

echo "=== Building BabyTracker LXC Template (${ARCH}) ==="

# 1. Bootstrap Debian Trixie minimal rootfs
echo "[lxc] Bootstrapping Debian Trixie..."
debootstrap --variant=minbase --arch="${ARCH}" trixie "${ROOTFS}" http://deb.debian.org/debian

# 2. Mount virtual filesystems for chroot
mount -t proc proc "${ROOTFS}/proc"
mount -t sysfs sys "${ROOTFS}/sys"
mount --bind /dev "${ROOTFS}/dev"
mount -t devpts devpts "${ROOTFS}/dev/pts"

# 3. Install required packages
echo "[lxc] Installing packages..."
chroot "${ROOTFS}" apt-get update
chroot "${ROOTFS}" apt-get install -y --no-install-recommends \
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
    systemd \
    systemd-sysv \
    dbus \
    ca-certificates \
    curl \
    iproute2
chroot "${ROOTFS}" apt-get clean

# 4. Copy shared config files
echo "[lxc] Installing BabyTracker config files..."
cp -a "${COMMON_DIR}/files/." "${ROOTFS}/"

# 5. Install common provisioning scripts
mkdir -p "${ROOTFS}/usr/lib/babytracker/common"
cp "${COMMON_DIR}/install.sh" \
   "${COMMON_DIR}/setup-postgres.sh" \
   "${COMMON_DIR}/setup-tls.sh" \
   "${COMMON_DIR}/setup-ufw.sh" \
   "${ROOTFS}/usr/lib/babytracker/common/"
chmod 755 "${ROOTFS}/usr/lib/babytracker/common/"*.sh

# 6. Install the binary
echo "[lxc] Installing BabyTracker binary..."
install -m 755 "${BABYTRACKER_BINARY}" "${ROOTFS}/usr/local/bin/babytracker"

# 7. Create system user and directories
chroot "${ROOTFS}" useradd --system --no-create-home --shell /usr/sbin/nologin babytracker
install -d -m 750 -o 999 -g 999 "${ROOTFS}/var/lib/babytracker"
# Note: UID/GID 999 is typical for the first system user; chown by name after first boot.
# The .needs-setup flag is NOT set — LXC boots directly into production mode.

# 8. Configure networking (systemd-networkd DHCP on all ethernet interfaces)
mkdir -p "${ROOTFS}/etc/systemd/network"
cat > "${ROOTFS}/etc/systemd/network/80-dhcp.network" << 'NETEOF'
[Match]
Name=eth*

[Network]
DHCP=yes

[DHCPv4]
UseDNS=yes
NETEOF
chroot "${ROOTFS}" systemctl enable systemd-networkd
# systemd-resolved may not be present in minbase — fall back to static resolv.conf
if chroot "${ROOTFS}" systemctl enable systemd-resolved 2>/dev/null; then
    echo "[lxc] systemd-resolved enabled."
else
    echo "[lxc] systemd-resolved not available, using static resolv.conf."
    echo "nameserver 1.1.1.1" > "${ROOTFS}/etc/resolv.conf"
    echo "nameserver 8.8.8.8" >> "${ROOTFS}/etc/resolv.conf"
fi

# 9. Fix permissions
chroot "${ROOTFS}" chown root:babytracker /etc/babytracker/babytracker.env
chmod 640 "${ROOTFS}/etc/babytracker/babytracker.env"

# 9. Enable services (PostgreSQL, avahi, babytracker)
chroot "${ROOTFS}" systemctl enable postgresql
chroot "${ROOTFS}" systemctl enable avahi-daemon
chroot "${ROOTFS}" systemctl enable babytracker.service

# The firstboot service runs on first boot to init PG, generate TLS cert, etc.
# We set .needs-setup so it runs once, then the ConditionPathExists guard prevents re-runs.
# Actually for LXC we want firstboot to run but NOT the setup-ap (no WiFi).
# Create a simpler firstboot that calls the common scripts directly.
cat > "${ROOTFS}/usr/local/bin/babytracker-firstboot.sh" << 'FIRSTBOOT'
#!/bin/bash
set -euo pipefail
exec > >(tee -a /var/log/babytracker-firstboot.log) 2>&1
echo "=== BabyTracker First Boot Setup (LXC) ==="
echo "Date: $(date)"

COMMON_DIR="/usr/lib/babytracker/common"

# Initialize PostgreSQL with default tuning (suitable for 1-2GB RAM)
"${COMMON_DIR}/setup-postgres.sh"

# Generate self-signed TLS certificate
"${COMMON_DIR}/setup-tls.sh"

# Configure production firewall
"${COMMON_DIR}/setup-ufw.sh"

# Remove setup flag and enable main service
rm -f /var/lib/babytracker/.needs-setup
systemctl daemon-reload
systemctl enable babytracker.service
systemctl start babytracker.service

echo "=== First boot setup complete ==="
FIRSTBOOT
chmod 755 "${ROOTFS}/usr/local/bin/babytracker-firstboot.sh"

# Set the .needs-setup flag so firstboot runs on first container start
touch "${ROOTFS}/var/lib/babytracker/.needs-setup"
chroot "${ROOTFS}" chown -R babytracker:babytracker /var/lib/babytracker
chroot "${ROOTFS}" systemctl enable babytracker-firstboot.service

# 10. Clean up for template
echo "[lxc] Cleaning up for template..."
rm -rf "${ROOTFS}/var/lib/apt/lists/"*
rm -f "${ROOTFS}/etc/machine-id"
: > "${ROOTFS}/etc/hostname"

# 11. Unmount virtual filesystems before packing
echo "[lxc] Unmounting virtual filesystems..."
umount "${ROOTFS}/dev/pts" 2>/dev/null || true
umount "${ROOTFS}/dev" 2>/dev/null || true
umount "${ROOTFS}/sys" 2>/dev/null || true
umount "${ROOTFS}/proc" 2>/dev/null || true

# 12. Pack the rootfs
echo "[lxc] Creating tarball..."
mkdir -p "${OUTPUT_DIR}"
TARBALL="${OUTPUT_DIR}/babytracker-lxc-${ARCH}.tar.zst"
tar -C "${ROOTFS}" -cf "${TARBALL}" --zstd .

echo "=== LXC template built: ${TARBALL} ==="
echo ""
echo "Import into Proxmox:"
echo "  pct create <vmid> <storage>:vztmpl/$(basename "${TARBALL}") \\"
echo "    --hostname babytracker --net0 name=eth0,bridge=vmbr0,ip=dhcp \\"
echo "    --memory 1024 --cores 2 --rootfs <storage>:4 --unprivileged 1"
