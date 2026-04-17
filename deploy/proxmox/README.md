# Proxmox Deployment

Two deployment options for running BabyTracker on Proxmox: LXC containers (lightweight) or full VMs.

## LXC Container

### Quick install (one command)

SSH into your Proxmox host and run:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/mbentancour/babytracker/main/deploy/proxmox/lxc/install.sh)
```

This downloads the pre-built template from GitHub Releases, creates a container, starts it, and prints the URL when ready.

Customize with environment variables:

```bash
BT_VMID=200 BT_MEMORY=2048 BT_STORAGE=local-zfs bash <(curl -fsSL ...)
```

| Variable | Default | Description |
|----------|---------|-------------|
| `BT_VMID` | (next available) | Container ID |
| `BT_STORAGE` | `local-lvm` | Storage pool |
| `BT_BRIDGE` | `vmbr0` | Network bridge |
| `BT_MEMORY` | `1024` | Memory in MB |
| `BT_CORES` | `2` | CPU cores |
| `BT_DISK` | `4` | Disk size in GB |
| `BT_VERSION` | `latest` | Release tag to download |

### Build from source

If you prefer to build the LXC template yourself:

```bash
# Build the Go binary first
CGO_ENABLED=0 go build -o babytracker.bin ./cmd/babytracker/

# Build the LXC template (requires root, debootstrap, zstd)
sudo BABYTRACKER_BINARY=./babytracker.bin deploy/proxmox/lxc/build-lxc-template.sh
```

Then import manually:

```bash
# Copy the tarball to Proxmox
scp output/babytracker-lxc-amd64.tar.zst root@pve:/var/lib/vz/template/cache/

# Create a container
pct create 200 local:vztmpl/babytracker-lxc-amd64.tar.zst \
  --hostname babytracker \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --memory 1024 --cores 2 \
  --rootfs local-lvm:4 \
  --unprivileged 1 \
  --features nesting=1

# Start it — first boot initializes PostgreSQL, generates TLS cert, configures firewall
pct start 200
```

### Checking status

```bash
# Watch first boot progress
pct exec <vmid> -- journalctl -u babytracker-firstboot -f

# Check service status
pct exec <vmid> -- systemctl status babytracker

# Access the app
pct exec <vmid> -- curl -k https://localhost:8099
```

## VM (Packer)

Build a Proxmox VM template using Packer's `proxmox-clone` builder.

### Prerequisites

1. **Packer** installed on your workstation
2. **Proxmox API token** with VM creation permissions
3. **Debian 13 cloud-init template** in Proxmox — create one if you don't have it:

```bash
# On the Proxmox host:
wget https://cloud.debian.org/images/cloud/trixie/daily/latest/debian-13-genericcloud-amd64.qcow2
qm create 9000 --name debian-13-cloud --memory 2048 --cores 2 --net0 virtio,bridge=vmbr0
qm importdisk 9000 debian-13-genericcloud-amd64.qcow2 local-lvm
qm set 9000 --scsihw virtio-scsi-pci --scsi0 local-lvm:vm-9000-disk-0
qm set 9000 --boot c --bootdisk scsi0
qm set 9000 --ide2 local-lvm:cloudinit
qm set 9000 --serial0 socket --vga serial0
qm set 9000 --ipconfig0 ip=dhcp
qm set 9000 --ciuser root --cipassword "packer"
qm template 9000
```

### Build

```bash
# Build the Go binary first
CGO_ENABLED=0 go build -o babytracker.bin ./cmd/babytracker/

# Configure Packer variables
cp deploy/proxmox/vm/variables.pkrvars.hcl.example deploy/proxmox/vm/variables.pkrvars.hcl
# Edit variables.pkrvars.hcl with your Proxmox details

# Initialize Packer plugins
cd deploy/proxmox/vm
packer init vm.pkr.hcl

# Build the template
packer build -var-file=variables.pkrvars.hcl vm.pkr.hcl
```

### Create a VM from the template

```bash
# Clone the template in the Proxmox UI or via CLI
qm clone <template-id> <new-id> --name babytracker --full
qm start <new-id>
```

The VM's first boot initializes PostgreSQL, generates a TLS cert, and starts BabyTracker.
Access at `https://<vm-ip>:8099`.
