# BabyTracker

A self-hosted baby tracking application. Single binary, no external dependencies beyond PostgreSQL. 

Inspired by the amazing Baby Buddy app, this project was created with the goal of simplifying the experience for non-technical users.

The code base was built from scratch and AI was used to accelerate the development, but real effort (from an actual human) has been put into making it as good as possible with the hope that it can be useful to other parents out there. 

Since I use it on a wall-mounted tablet, it includes a "picture frame" slideshow mode that activates when the device is idle. This feature can be configured or completely disabled. If you have a feature request or want to report a bug, open an issue or a pull request.

## Features

- **Track everything**: feedings, sleep, diapers, tummy time, temperature, weight, height, head circumference, pumping, BMI, medications, milestones, notes, and photos. Multi-child support.
- **WHO growth percentile charts** overlaid on weight/height/head circumference/BMI curves for context
- **Self-contained Go binary** with embedded React SPA -- nothing else to install
- **PostgreSQL** database with automatic migrations
- **JWT authentication** with role-based access control (RBAC)
- **Per-child, per-feature permissions** (none / read / write) for multi-user setups
- **Photo gallery** with on-the-fly thumbnails, click-to-enlarge lightbox, tagging, and picture frame slideshow mode
- **Picture frame mode** with optional live status overlay (last feeding, active timers, current time...)
- **Real-time display control** via SSE (designed for wall-mounted tablets)
- **Home Assistant integration** with sensors, events, and services (see [`babytracker-homeassistant`](https://github.com/mbentancour/babytracker-homeassistant))
- **Automatic backups** with per-destination cron schedules, retention policies, and optional AES-256-GCM encryption. Push to local paths and/or WebDAV (Nextcloud, ownCloud, Synology, etc.)
- **Restore from backup at first boot** — bring an instance back up on a new machine without re-creating accounts
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
| Go        | 1.26    |
| React     | 19      |
| PostgreSQL| 18      |
| Chi       | v5      |
| Vite      | 8       |
| Recharts  | 3       |

## License

[MIT](LICENSE) — do whatever you want with it.

### In plain English

I'm releasing this under MIT because I want to make it as easy as possible for anyone to use, fork, remix, learn from, or run their own version. No strings attached.

**My intent, as of April 2026:**

- I have no plans to make money from this software. It is, and will remain, open source.
- If a commercial product ever happens, it will be something *built around* the software — for example, pre-configured Raspberry Pi appliances with the image pre-burned, or a hosted SaaS for people who do not want to self-host. The software itself will stay open source either way.
- I will never add an "open core", "source available", or license-change-at-v2 twist. If you see this code today, you can keep using it forever under these terms.
- There are no current plans for any commercial offering, but having worked in the software industry, I've seen enough projects switch to restrictive licenses after they become successful that I want to be clear about my intentions with this piece of software.

This is not a legal addendum — the MIT license is the only thing that legally governs your use of this code. This section is just my promise to the people using it about how I intend to act.
