# BabyTracker

A self-hosted baby tracking application. Single binary, no external dependencies beyond PostgreSQL. 

Inspired by the amazing Baby Buddy app, this project was created with the goal of simplifying the experience for non-technical users. The code base was built from scratch and AI was used to accelerate the development, but real effort (from an actual human) has been put into making it as good as possible with the hope that it can be useful to other parents out there. Since I use it on a wall-mounted tablet, it includes a "picture frame" slideshow mode that activates when the device is idle. This feature can be configured or completely disabled. If you have a feature request or want to report a bug, open an issue or a pull request.

## Features

- **Track everything**: feedings, sleep, diapers, tummy time, temperature, weight, height, head circumference, pumping, BMI, medications, milestones, notes, and photos. Multi-child support.
- **Self-contained Go binary** with embedded React SPA -- nothing else to install
- **PostgreSQL** database with automatic migrations
- **JWT authentication** with role-based access control (RBAC)
- **Per-child, per-feature permissions** (none / read / write) for multi-user setups
- **Photo gallery** with tagging and picture frame slideshow mode
- **Real-time display control** via SSE (designed for wall-mounted tablets)
- **Automatic backups** with configurable frequency
- **Baby Buddy data import**
- **API tokens and webhooks** for external integrations
- **Multi-language**: English, Spanish, Danish
- **Light / dark / system theme**
- **Optional Let's Encrypt HTTPS** via autocert
- **CSV data export**
- **Mobile-responsive** design with safe area support

## Quick Start

The fastest way to try BabyTracker is with Docker Compose:

```bash
git clone https://github.com/mbentancour/babytracker.git
cd babytracker
docker compose -f deploy/docker/docker-compose.yml up
```

Then visit [http://localhost:8099](http://localhost:8099).

## Installation

Four installation options are available (see [INSTALL.md](INSTALL.md) for details):

1. **Raspberry Pi appliance** -- flash the image, plug in, done
2. **Home Assistant add-on**
3. **Docker Compose**
4. **Manual installation**

## Documentation

- [Installation Guide](INSTALL.md) -- all deployment options
- [User Guide](USER-GUIDE.md) -- how to use the app day-to-day
- [API Documentation](API.md) -- REST API reference for integrations

## Screenshots

Screenshots coming soon.

## Tech Stack

| Component | Version |
|-----------|---------|
| Go        | 1.25    |
| React     | 19      |
| PostgreSQL| 17      |
| Chi       | v5      |
| Vite      | 6       |
| Recharts  | latest  |

## License

TBD, but it will be some sort of permissive open source license. 
