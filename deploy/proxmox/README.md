# Proxmox Deployment

Two deployment options for running BabyTracker on Proxmox: LXC containers (lightweight) or full VMs.

## LXC Container

Build a rootfs tarball and import it as a Proxmox LXC template.

### Prerequisites

- Linux host with root access
- `debootstrap` and `zstd` installed
- Pre-built BabyTracker binary

### Build

```bash
# Build the Go binary first
CGO_ENABLED=0 go build -o babytracker.bin ./cmd/babytracker/

# Build the LXC template
sudo BABYTRACKER_BINARY=./babytracker.bin deploy/proxmox/lxc/build-lxc-template.sh
```

### Import into Proxmox

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

The container is ready when `babytracker-firstboot.service` completes. Check progress:

```bash
pct exec 200 -- journalctl -u babytracker-firstboot -f
```

Access at `https://<container-ip>:8099`.

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
