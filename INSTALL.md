# BabyTracker Installation Guide

## 1. Raspberry Pi Appliance (recommended for non-technical users)

The simplest way to run BabyTracker. Download a pre-built image, flash it, and go.

**Supported hardware:** Raspberry Pi Zero 2W, Pi 3B+, Pi 4, Pi 5 (all 64-bit).

### Steps

1. Download the latest `.img.xz` from [GitHub Releases](https://github.com/mbentancour/babytracker/releases).
2. Flash to an SD card using [Raspberry Pi Imager](https://www.raspberrypi.com/software/) or [balenaEtcher](https://etcher.balena.io/).
3. Insert the SD card into your Pi and power it on.
4. On your phone, connect to the **BabyTracker-Setup** Wi-Fi hotspot.
5. Follow the setup wizard to connect the Pi to your home Wi-Fi network.
6. Once connected, visit **https://babytracker.local** in your browser to create your account.

### Notes

- SSH is disabled by default.
- Automatic security updates are enabled.
- A self-signed TLS certificate is generated on first boot (your browser will show a certificate warning -- this is expected).

---

## 2. Home Assistant Add-on

Two modes are available: **Local** and **External**.

### Local (recommended)

Runs BabyTracker and PostgreSQL inside a single Home Assistant add-on container.

1. In Home Assistant, go to **Settings > Add-ons > Add-on Store**.
2. Click the three-dot menu and select **Repositories**.
3. Add: `https://github.com/mbentancour/babytracker`
4. Find and install the **BabyTracker** add-on.
5. Start the add-on. PostgreSQL runs inside the container automatically.
6. Access BabyTracker via the HA sidebar (ingress).

Data is persisted in the `/data/` volume managed by Home Assistant.

**Add-on configuration options:**

| Option | Default | Description |
|--------|---------|-------------|
| `unit_system` | `metric` | `metric` or `imperial` |
| `demo_mode` | `false` | Skip authentication (for demos) |
| `media_path` | (empty) | Path to HA media directory for photos |

> Backup schedules are now configured per-destination from the UI (Settings → Data → Backup destinations), not via add-on options.

### External (proxy to existing instance)

Use this if you already have BabyTracker running elsewhere and want HA ingress access.

1. Install the BabyTracker add-on as above.
2. In the add-on configuration, set `mode` to `external`.
3. Set `external_url` to your existing BabyTracker instance URL (e.g., `https://192.168.1.50`).
4. Start the add-on. It proxies all requests to your external instance.

### Home Assistant integration (sensors, events, services)

If you want per-child sensors, event triggers (new feeding, new sleep, etc.),
and services to log activities from automations, install the separate
integration:

- Repo: [github.com/mbentancour/babytracker-homeassistant](https://github.com/mbentancour/babytracker-homeassistant)
- Install via HACS (Custom Repositories → Integration) or manually copy
  `custom_components/babytracker/` to your HA `config/` directory.

The integration connects to any running BabyTracker instance (add-on, Pi
image, Docker, or remote) using an API token created in BabyTracker →
Settings → Integrations → API Tokens.

> HACS doesn't manage Home Assistant add-ons, which is why the integration
> lives in a separate repository.

---

## 3. Proxmox (LXC or VM)

Run BabyTracker on a Proxmox hypervisor as a lightweight LXC container or a full VM.

### LXC Container (one command)

SSH into your Proxmox host and run:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/mbentancour/babytracker/main/deploy/proxmox/lxc/install.sh)
```

This downloads the pre-built LXC template from GitHub Releases, creates a container, and starts it. First boot initializes PostgreSQL, generates a TLS certificate, and starts BabyTracker.

Optional environment variables to customize the container:

| Variable | Default | Description |
|----------|---------|-------------|
| `BT_VMID` | (next available) | Container ID |
| `BT_STORAGE` | `local-lvm` | Storage pool |
| `BT_BRIDGE` | `vmbr0` | Network bridge |
| `BT_MEMORY` | `1024` | Memory in MB |
| `BT_CORES` | `2` | CPU cores |
| `BT_DISK` | `4` | Disk size in GB |
| `BT_VERSION` | `latest` | Release tag to download |

Example with custom settings:

```bash
BT_VMID=200 BT_MEMORY=2048 bash <(curl -fsSL https://raw.githubusercontent.com/mbentancour/babytracker/main/deploy/proxmox/lxc/install.sh)
```

### VM (Packer)

For a full VM, use the Packer template with the `proxmox-clone` builder. See [deploy/proxmox/README.md](deploy/proxmox/README.md) for prerequisites and instructions.

---

## 4. Docker Compose (recommended for servers)

A `docker-compose.yml` is included in the repository.

```bash
git clone https://github.com/mbentancour/babytracker.git
cd babytracker
docker compose -f deploy/docker/docker-compose.yml up -d
```

This starts two containers: the BabyTracker app and PostgreSQL 18.

- Default port: **443** (HTTPS)
- Database data persisted in the `pgdata` volume.

To set a JWT secret (recommended for production):

```bash
JWT_SECRET=your-secret-here docker compose -f deploy/docker/docker-compose.yml up -d
```

### Environment variables

Pass these via `environment` in your compose file or on the command line:

`DATABASE_URL`, `DATA_DIR`, `JWT_SECRET`, `UNIT_SYSTEM`, `DEMO_MODE`

See the [Configuration Reference](#6-configuration-reference) for the full list.

---

## 5. Manual Installation (for developers)

### Prerequisites

- Go 1.26+
- Node.js 22+
- PostgreSQL 17 or 18

### Steps

```bash
# Clone the repository
git clone https://github.com/mbentancour/babytracker.git
cd babytracker

# Build the frontend
cd frontend && npm ci && npm run build && cd ..

# Copy built assets to the embed directory
cp -r frontend/dist/* internal/router/static/

# Build the Go binary
go build -o babytracker ./cmd/babytracker/

# Create the database
createdb babytracker

# Run
DATABASE_URL="postgres://localhost/babytracker?sslmode=disable" ./babytracker
```

BabyTracker will be available at `https://localhost`.

---

## 6. Configuration Reference

All configuration is done through environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `443` | HTTPS listen port |
| `DATA_DIR` | `/var/lib/babytracker` | Directory for photos, backups, and JWT secret |
| `DATABASE_URL` | `postgres://babytracker:babytracker@localhost:5432/babytracker?sslmode=disable` | PostgreSQL connection string |
| `JWT_SECRET` | (auto-generated) | Session signing key. If not set, auto-created and persisted in `DATA_DIR/.jwt_secret` |
| `UNIT_SYSTEM` | `metric` | `metric` or `imperial` |
| `DEMO_MODE` | `false` | Skip authentication (for demos) |
| `TLS_CERT` | (empty) | Path to TLS certificate file |
| `TLS_KEY` | (empty) | Path to TLS private key file |
| `TLS_DOMAIN` | (empty) | Domain for Let's Encrypt autocert |
| `ACME_DNS_PROVIDER` | (empty) | DNS provider for DNS-01 challenge: `cloudflare`, `route53`, `duckdns`, `namecheap`, `simply` |
| `ACME_EMAIL` | `admin@{TLS_DOMAIN}` | Email for Let's Encrypt account (expiry notifications) |
| `ACME_MANAGE_A` | `true` | Automatically create/update the DNS A record for the domain |
| `ACME_IP` | (auto-detect) | IP for the A record. Empty = server's LAN IP. Set to public IP for external access. |
| `CERTS_DIR` | `{DATA_DIR}/certs` | Autocert cache directory |
| `MEDIA_PATH` | (empty) | External photo directory (used with HA media) |
| `BABYTRACKER_PROXY_URL` | (empty) | Proxy mode: forward all requests to this URL |
| `BACKUP_LOCAL_ROOTS` | (empty) | Colon-separated list of extra filesystem roots a Local backup destination may resolve into. `{DATA_DIR}/backups` is always allowed. Example: `/mnt/usb:/mnt/nas`. |
| `BABYTRACKER_HSTS_PRELOAD` | `false` | When `true` and the request arrived over TLS, append `preload` to the HSTS header. Only enable if you've registered the domain at [hstspreload.org](https://hstspreload.org) — it's a long-lived commitment. |

---

## 7. Updating

**Raspberry Pi image:** Download the new image and flash it. User data lives on a separate partition and is preserved across re-flashes.

**Home Assistant add-on:** Update through the HA UI (**Settings > Add-ons > BabyTracker > Update**).

**Docker Compose:**

```bash
docker compose -f deploy/docker/docker-compose.yml pull
docker compose -f deploy/docker/docker-compose.yml up -d
```

**Manual:** Pull the latest code, rebuild the frontend and Go binary, then restart the process.

---

## 8. Backups

> **Default PostgreSQL version by install mode:**
> - Docker Compose + Home Assistant add-on: **PG 18** (Alpine 3.23 / `postgres:18-alpine`)
> - Raspberry Pi appliance: **PG 17** (Debian Trixie's default meta-package)
>
> The gap exists because Debian Trixie doesn't ship PG 18 in its main archive yet. Backups are portable across the gap — the restore path filters incompatible `SET` statements from newer-client dumps and drops-then-recreates the schema in a single transaction, so a PG 18 dump restores cleanly onto PG 17 (and vice versa).

Backups are configured per-destination from **Settings > Data > Backup destinations** in the BabyTracker UI. Each destination has its own cron schedule, retention count, and optional AES-256-GCM encryption.

- A fresh install ships with a default **Local** destination at `{DATA_DIR}/backups/` running daily at 03:00, keeping the last 7.
- Add additional destinations for redundancy: another local path (USB, NFS mount), or a WebDAV server (Nextcloud, ownCloud, Synology, Infomaniak kDrive, etc.).
- Backups include a full database dump and all photos, packaged as a `.tar.gz` (or `.tar.gz.enc` when encrypted).
- The dump uses `pg_dump --clean --if-exists --no-owner --no-privileges`, so restores reliably overwrite the existing schema. Restores wipe and recreate the `public` schema before applying the dump (run inside `psql --single-transaction` with `ON_ERROR_STOP=1`), guaranteeing a clean target state.
- Restore options: from any configured destination, by uploading a file in the UI, or — on a brand-new install — from the first-boot screen (no admin account needed beforehand; sign in with the credentials from the backup).
- WebDAV note for Nextcloud: use `https://your-nextcloud/remote.php/dav/files/USERNAME/` and a Nextcloud **app password**, not your login password (Settings → Personal → Security → Devices & sessions). 2FA-enabled accounts will not authenticate with the login password at all.
- `pg_dump` and `psql` major versions should match the running PostgreSQL server. Mismatches (e.g. PG 17 client tools against a PG 16 server) can emit `SET` statements the server doesn't know — the restorer transparently filters known-incompatible ones, but matching versions avoids the issue entirely.
- Database credentials are passed to `pg_dump` / `psql` via the `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`/`PGSSLMODE` environment variables (parsed once from `DATABASE_URL`), **not** on the command line. This keeps the password out of `/proc/<pid>/cmdline`, which is world-readable on Linux.
- The on-disk format for encrypted backups is versioned at `0x02`. The format includes per-chunk ordering and end-of-stream binding in the AES-GCM AAD so truncation and reordering attacks against stored archives are detected on restore. There is no backwards-compatibility path: if you have archives from an older build, decrypt them on that build and re-encrypt once upgraded.

---

## 9. HTTPS / TLS

### Self-signed (default on Pi image)

A self-signed certificate is generated on first boot. Access BabyTracker at `https://babytracker.local`. Your browser will show a certificate warning -- accept it to proceed.

### Let's Encrypt with DNS-01 (recommended)

Get a valid TLS certificate using DNS validation. This works behind NAT on a private network — no port forwarding is needed for the certificate itself.

BabyTracker will:
1. Create/update a DNS **A record** pointing your domain to this server's IP (auto-detected or manually specified)
2. Create a DNS **TXT record** for the ACME DNS-01 challenge
3. Obtain and cache a Let's Encrypt certificate
4. Renew it automatically 30 days before expiry

**DNS A record behavior:** By default, BabyTracker sets the A record to your server's LAN IP. This means the domain resolves to your server on your local network — browsers on the same network can access it at `https://baby.example.com` with a valid certificate and no warnings.

**External access:** If you want to access BabyTracker from outside your network, set `ACME_IP` to your **public** IP address (or use the Settings UI) and forward **port 443** on your router to the server. Without port forwarding, the domain will only work from within your LAN.

Set `TLS_DOMAIN`, `ACME_DNS_PROVIDER`, and the provider's credentials:

**Cloudflare:**

```bash
TLS_DOMAIN=baby.example.com
ACME_DNS_PROVIDER=cloudflare
CF_DNS_API_TOKEN=your-api-token      # Zone:DNS:Edit permission
```

**Route53 (AWS):**

```bash
TLS_DOMAIN=baby.example.com
ACME_DNS_PROVIDER=route53
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_HOSTED_ZONE_ID=Z1234567890       # optional, speeds up lookup
```

**DuckDNS:**

```bash
TLS_DOMAIN=yourname.duckdns.org
ACME_DNS_PROVIDER=duckdns
DUCKDNS_TOKEN=your-token
```

**Namecheap:**

```bash
TLS_DOMAIN=baby.example.com
ACME_DNS_PROVIDER=namecheap
NAMECHEAP_API_USER=your-username
NAMECHEAP_API_KEY=your-api-key
```

**Simply.com:**

```bash
TLS_DOMAIN=baby.example.com
ACME_DNS_PROVIDER=simply
SIMPLY_ACCOUNT_NAME=your-account
SIMPLY_API_KEY=your-api-key
```

**Additional options:**

| Variable | Default | Description |
|----------|---------|-------------|
| `ACME_MANAGE_A` | `true` | Set to `false` to skip A record management (if you manage DNS records yourself) |
| `ACME_IP` | (auto-detect) | IP address for the A record. Auto-detects LAN IP if empty. Set to your public IP for external access. |

Certificates are cached in `CERTS_DIR` and renewed automatically 30 days before expiry. The server starts immediately with a self-signed certificate while the Let's Encrypt cert is obtained in the background — if ACME fails, the server stays up and you can fix the configuration in Settings.

### Let's Encrypt with HTTP-01

If your server is publicly reachable on port 443:

1. Create a DNS A record pointing to your server's public IP.
2. Forward port **443** on your router to the device.
3. Set `TLS_DOMAIN` to your domain (without `ACME_DNS_PROVIDER`).

BabyTracker will use the HTTP-01 challenge on port 80 to validate and obtain a certificate.

### Manual TLS

To use your own certificate files, set `TLS_CERT` and `TLS_KEY` to the paths of your certificate and private key files.
