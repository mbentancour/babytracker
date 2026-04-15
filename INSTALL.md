# BabyTracker Installation Guide

## 1. Raspberry Pi Appliance (recommended for non-technical users)

The simplest way to run BabyTracker. Download a pre-built image, flash it, and go.

**Supported hardware:** Raspberry Pi Zero 2W, Pi 3B+, Pi 4, Pi 5 (all 64-bit).

### Steps

1. Download the latest `.img.gz` from [GitHub Releases](https://github.com/mbentancour/babytracker/releases).
2. Flash to an SD card using [Raspberry Pi Imager](https://www.raspberrypi.com/software/) or [balenaEtcher](https://etcher.balena.io/).
3. Insert the SD card into your Pi and power it on.
4. On your phone, connect to the **BabyTracker-Setup** Wi-Fi hotspot.
5. Follow the setup wizard to connect the Pi to your home Wi-Fi network.
6. Once connected, visit **https://babytracker.local:8099** in your browser to create your account.

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
| `backup_frequency` | `daily` | `disabled`, `6h`, `12h`, `daily`, `weekly` |
| `demo_mode` | `false` | Skip authentication (for demos) |
| `media_path` | (empty) | Path to HA media directory for photos |

### External (proxy to existing instance)

Use this if you already have BabyTracker running elsewhere and want HA ingress access.

1. Install the BabyTracker add-on as above.
2. In the add-on configuration, set `mode` to `external`.
3. Set `external_url` to your existing BabyTracker instance URL (e.g., `https://192.168.1.50:8099`).
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

## 3. Docker Compose (recommended for servers)

A `docker-compose.yml` is included in the repository.

```bash
git clone https://github.com/mbentancour/babytracker.git
cd babytracker
docker compose -f deploy/docker/docker-compose.yml up -d
```

This starts two containers: the BabyTracker app and PostgreSQL 17.

- Default port: **8099**
- Database data persisted in the `pgdata` volume.

To set a JWT secret (recommended for production):

```bash
JWT_SECRET=your-secret-here docker compose -f deploy/docker/docker-compose.yml up -d
```

### Environment variables

Pass these via `environment` in your compose file or on the command line:

`DATABASE_URL`, `DATA_DIR`, `JWT_SECRET`, `UNIT_SYSTEM`, `DEMO_MODE`

See the [Configuration Reference](#5-configuration-reference) for the full list.

---

## 4. Manual Installation (for developers)

### Prerequisites

- Go 1.25+
- Node.js 22+
- PostgreSQL 17

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

BabyTracker will be available at `http://localhost:8099`.

---

## 5. Configuration Reference

All configuration is done through environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8099` | HTTP listen port |
| `DATA_DIR` | `/var/lib/babytracker` | Directory for photos, backups, and JWT secret |
| `DATABASE_URL` | `postgres://babytracker:babytracker@localhost:5432/babytracker?sslmode=disable` | PostgreSQL connection string |
| `JWT_SECRET` | (auto-generated) | Session signing key. If not set, auto-created and persisted in `DATA_DIR/.jwt_secret` |
| `UNIT_SYSTEM` | `metric` | `metric` or `imperial` |
| `BACKUP_FREQUENCY` | `daily` | `disabled`, `6h`, `12h`, `daily`, `weekly` |
| `DEMO_MODE` | `false` | Skip authentication (for demos) |
| `TLS_CERT` | (empty) | Path to TLS certificate file |
| `TLS_KEY` | (empty) | Path to TLS private key file |
| `TLS_DOMAIN` | (empty) | Domain for Let's Encrypt autocert |
| `CERTS_DIR` | `{DATA_DIR}/certs` | Autocert cache directory |
| `MEDIA_PATH` | (empty) | External photo directory (used with HA media) |
| `BABYTRACKER_PROXY_URL` | (empty) | Proxy mode: forward all requests to this URL |

---

## 6. Updating

**Raspberry Pi image:** Download the new image and flash it. User data lives on a separate partition and is preserved across re-flashes.

**Home Assistant add-on:** Update through the HA UI (**Settings > Add-ons > BabyTracker > Update**).

**Docker Compose:**

```bash
docker compose -f deploy/docker/docker-compose.yml pull
docker compose -f deploy/docker/docker-compose.yml up -d
```

**Manual:** Pull the latest code, rebuild the frontend and Go binary, then restart the process.

---

## 7. Backups

- Configure automatic backups in **Settings > Data** within the BabyTracker UI.
- Trigger manual backup or restore from the same settings page.
- Backups include a full database dump and all photos, packaged as a `.tar.gz` file.
- Backup files are stored in `{DATA_DIR}/backups/`.

---

## 8. HTTPS / TLS

### Self-signed (default on Pi image)

A self-signed certificate is generated on first boot. Access BabyTracker at `https://babytracker.local:8099`. Your browser will show a certificate warning -- accept it to proceed.

### Let's Encrypt (custom domain)

To get a trusted certificate automatically:

1. Register a domain and create a DNS A record pointing to your BabyTracker device's public IP.
2. Forward port **443** on your router to the device.
3. In BabyTracker, go to **Settings > General** and enter your domain.
4. Set the `TLS_DOMAIN` environment variable to the same domain, or configure it via the UI.

BabyTracker will obtain and renew certificates from Let's Encrypt automatically.

### Manual TLS

To use your own certificate files, set `TLS_CERT` and `TLS_KEY` to the paths of your certificate and private key files.
