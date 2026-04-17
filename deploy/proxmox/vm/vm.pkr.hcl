packer {
  required_plugins {
    proxmox = {
      version = ">= 1.2.2"
      source  = "github.com/hashicorp/proxmox"
    }
  }
}

# --- Proxmox connection ---

variable "proxmox_url" {
  type        = string
  description = "Proxmox API URL (e.g. https://pve.local:8006/api2/json)"
}

variable "proxmox_token_id" {
  type        = string
  description = "API token ID (e.g. root@pam!packer)"
}

variable "proxmox_token_secret" {
  type      = string
  sensitive = true
}

variable "proxmox_node" {
  type    = string
  default = "pve"
}

variable "proxmox_skip_tls" {
  type    = bool
  default = true
}

# --- Template settings ---

variable "clone_vm" {
  type        = string
  description = "Name or ID of the Debian 13 cloud-init base template to clone from"
  default     = "debian-13-cloud"
}

variable "vm_id" {
  type    = number
  default = 0 # auto-assign
}

variable "storage" {
  type    = string
  default = "local-lvm"
}

variable "network_bridge" {
  type    = string
  default = "vmbr0"
}

variable "cores" {
  type    = number
  default = 2
}

variable "memory" {
  type    = number
  default = 2048
}

variable "disk_size" {
  type    = string
  default = "8G"
}

# --- BabyTracker ---

variable "babytracker_binary" {
  type        = string
  description = "Path to pre-built BabyTracker binary on the build host"
}

source "proxmox-clone" "babytracker" {
  proxmox_url              = var.proxmox_url
  username                 = var.proxmox_token_id
  token                    = var.proxmox_token_secret
  node                     = var.proxmox_node
  insecure_skip_tls_verify = var.proxmox_skip_tls

  clone_vm = var.clone_vm
  vm_id    = var.vm_id
  vm_name  = "babytracker-template"

  cores  = var.cores
  memory = var.memory

  network_adapters {
    bridge = var.network_bridge
    model  = "virtio"
  }

  cloud_init              = true
  cloud_init_storage_pool = var.storage

  ssh_username = "root"
  ssh_timeout  = "10m"

  template_name = "babytracker-template"
}

build {
  sources = ["source.proxmox-clone.babytracker"]

  # Upload provisioning scripts
  provisioner "file" {
    source      = "${path.root}/../../common/"
    destination = "/tmp/babytracker-common/"
  }

  # Upload the binary
  provisioner "file" {
    source      = var.babytracker_binary
    destination = "/usr/local/bin/babytracker"
  }

  # Install dependencies
  provisioner "shell" {
    script = "${path.root}/scripts/install-deps.sh"
  }

  # Run the common install script
  provisioner "shell" {
    inline = [
      "chmod +x /usr/local/bin/babytracker",
      "chmod +x /tmp/babytracker-common/*.sh",
      "mkdir -p /usr/lib/babytracker/common",
      "cp /tmp/babytracker-common/*.sh /usr/lib/babytracker/common/",
      "cp -a /tmp/babytracker-common/files/. /",
      "/tmp/babytracker-common/install.sh",
    ]
  }

  # Clean up for templating
  provisioner "shell" {
    inline = [
      "rm -rf /tmp/babytracker-common",
      "cloud-init clean --logs",
      "truncate -s 0 /etc/machine-id",
      "rm -f /var/lib/dbus/machine-id",
      "apt-get clean",
      "rm -rf /var/lib/apt/lists/*",
      "sync",
    ]
  }
}
