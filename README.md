# BabyTracker

A self-hosted baby tracking application. Single binary, no external dependencies beyond PostgreSQL. 

Inspired by the amazing Baby Buddy app, this project was created with the goal of simplifying the experience for non-technical users.

The code base was built from scratch and AI was used to accelerate the development, but real effort (from an actual human) has been put into making it as good as possible with the hope that it can be useful to other parents out there. 

Since I use it on a wall-mounted tablet, it includes a "picture frame" slideshow mode that activates when the device is idle. This feature can be configured or completely disabled. If you have a feature request or want to report a bug, open an issue or a pull request.

## Screenshots

| Overview | Growth |
|---|---|
| ![Overview tab — today's activity at a glance](docs/screenshots/Overview.png) | ![Growth tab — weight, height, head circumference, BMI with WHO percentile overlays](docs/screenshots/Growth.png) |

| Journal | Photos |
|---|---|
| ![Journal tab — chronological log of all entries with type filters](docs/screenshots/Journal.png) | ![Photos tab — gallery of photos attached to entries](docs/screenshots/Photos.png) |

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
- **Automatic backups** with per-destination cron schedules, retention policies, and optional AES-256-GCM encryption. Push to local paths, WebDAV (Nextcloud, ownCloud, Synology, etc.), or any S3-compatible service (AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi).
- **Restore from backup at first boot** — bring an instance back up on a new machine without re-creating accounts
- **Baby Buddy data import**
- **API tokens and webhooks** for external integrations
- **Multi-language**: English, Spanish, Danish
- **Light / dark / system theme**
- **HTTPS by default** on port 443 (self-signed certificate, upgradeable to Let's Encrypt via DNS-01 with Cloudflare, Route53, DuckDNS, Namecheap, or Simply.com)
- **CSV data export**
- **Mobile-responsive** design with safe area support

## Quick Start

The fastest way to try BabyTracker is with Docker Compose:

```bash
git clone https://github.com/mbentancour/babytracker.git
cd babytracker
docker compose -f deploy/docker/docker-compose.yml up
```

Then visit [https://localhost](https://localhost).

## Installation

Six installation options are available (see [INSTALL.md](INSTALL.md) for details):

1. **Raspberry Pi appliance** -- flash the image, plug in, done
2. **Home Assistant add-on**
3. **Proxmox** -- one-command LXC install or Packer VM template
4. **Kubernetes** -- Helm chart in `deploy/helm/babytracker/`
5. **Docker Compose**
6. **Manual installation**

## Progressive Web App (PWA)

BabyTracker runs as a Progressive Web App so you can install it on a tablet, phone, or desktop and use it without an active internet connection. The app caches all static assets and API responses, queues writes while offline, and replays them automatically when the network returns.

### Installing the app

| Platform | How to install |
|---|---|
| **Android (Chrome)** | Tap the install banner that appears after first visit, or use the browser menu **⋮ → Install app**. |
| **iOS (Safari)** | Open the app in Safari, tap the **Share** button, then scroll and tap **Add to Home Screen**. |
| **Desktop (Chrome / Edge)** | Click the install icon in the address bar, or use the browser menu **⋮ → Install BabyTracker**. |

Once installed the app launches in its own window (standalone mode) with no browser chrome, and continues working when the Pi is offline.

### Offline behavior

| Feature | What happens offline |
|---|---|
| **Pages & assets** | Served from the service worker's precache — the app loads instantly. |
| **Reading data** | The last cached API responses are shown; a thin offline banner appears at the top of the page when connectivity is lost. |
| **Writing data** | Feedings, sleep logs, and every other tracked entry are queued in IndexedDB. A small indicator in the header shows the queue depth. On reconnection the queue replays automatically, and failed writes surface an error badge. |
| **Gallery / photos** | Photo metadata is cached, but actual photo images require the network (gallery endpoints are `NetworkOnly` in the service worker). |

### Caching strategy

| Scope | Strategy | Details |
|---|---|---|
| Static assets (JS, CSS, images) | Precached at install / update | All Vite-built files are precached via Workbox. |
| API responses (JSON) | NetworkFirst, 5 s fallback to cache | Cached for 24 h, up to 50 entries (R009). |
| Gallery & photos | NetworkOnly | Always fetched live from the server. |

### Development

PWA assets (manifest, service worker, icons) are generated at build time by [`vite-plugin-pwa`](https://github.com/vite-pwa/vite-plugin). Run `npm run build` in the `frontend/` directory and the output includes everything needed: `sw.js`, `manifest.webmanifest`, icon images, and the `registerSW.js` registration script.

## End-to-End Testing (Playwright)

BabyTracker ships a Playwright test suite covering PWA installability, offline behaviour, IndexedDB persistence, and write-queue replay. The tests are located in `frontend/e2e/`.

### Quick start

Install Playwright browsers once, then run the full suite against the Vite production build:

```bash
cd frontend

# 1. Install Playwright system dependencies (one-time)
npx playwright install --with-deps chromium firefox webkit

# 2. Run all tests (builds + previews the app automatically)
npx playwright test
```

The `playwright.config.ts` `webServer` hook builds the frontend (`npm run build`) and serves it via `vite preview` on port 5173 before running each test run. You do not need a running backend — the tests intercept API calls and use demo mode.

### What the tests cover

| File | Scope |
|---|---|
| `smoke.spec.ts` | PWA manifest validation, icon availability, service worker serving, iOS meta tags, Workbox runtime cache config, IndexedDB cache module, install prompt component |
| `offline-ui.spec.ts` | Offline banner visibility, reconnecting flash state, banner dismissal, gallery offline state, write-queue indicator presence |
| `write-queue.spec.ts` | IndexedDB write persistence (correct order), replay on reconnect, failed write error marking with HTTP status + message |

### Architecture note: mocking offline

The tests use `context.setOffline(true)` (Playwright's browser-engine-level network simulation) rather than `page.evaluate()` to mock `navigator.onLine`, because `navigator.onLine` is read-only in Chromium and cannot be overridden via JavaScript evaluation. `context.setOffline()` simulates disconnection at the network stack level, which is the most reliable approach for PWA testing.

### Running a single test file or project

```bash
# One test file only
npx playwright test e2e/offline-ui.spec.ts

# One browser engine (useful for debugging engine-specific bugs)
npx playwright test --project chromium
npx playwright test --project firefox
npx playwright test --project webkit

# Only the write-queue tests
npx playwright test e2e/write-queue.spec.ts
```

### CI configuration

In CI (`CI` environment variable set) the tests run with:
- **One retry** on failure (transient flakiness is retried once)
- **Traces** captured on first retry only
- **Forbid-only** enabled (failing tests block the pipeline)

To emulate CI locally:

```bash
CI=1 npx playwright test --reporter=html
```

This generates `frontend/playwright-report/index.html` with a full visual report.

### Debugging failures

When a test fails, a screenshot and Playwright trace are saved under `frontend/test-results/`. To open the trace inspector:

```bash
npx playwright show-trace frontend/test-results/<path-to-trace.zip>
```

To replay a failing test in an interactive Chromium browser (keeps the page open after the test):

```bash
npx playwright test --debug e2e/offline-ui.spec.ts
```

### Adding new tests

- Use the `context.setOffline(true/false)` pattern for offline simulation (see existing tests for reference).
- Enable demo mode by routing `/api/config` to return `{ "demo_mode": true }` before navigation (see `enableDemoMode()` helper).
- For IndexedDB tests, use `page.evaluate()` to interact with `keyval-store` directly, as the `idb-keyval` library uses that DB name.
- Write tests for both the component level (banner renders) and the source level (configuration constants in `.js`/`.jsx` files) where applicable.

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

[MIT](LICENSE)

### In plain English

TL;DR: Do whatever you want with it. 

I'm releasing this under MIT because I want to make it as easy as possible for anyone to use, fork, remix, learn from, or run their own version. No strings attached.

**My intent, as of April 2026:**

- I have no plans to make money from this software. It is, and will remain, open source.
- If a commercial product ever happens, it will be something *built around* the software — for example, pre-configured Raspberry Pi appliances with the image pre-burned, or a hosted SaaS for people who do not want to self-host. The software itself will stay open source either way.
- I will never add an "open core", "source available", or license-change-at-v2 twist. If you see this code today, you can keep using it forever under these terms.
- There are no current plans for any commercial offering, but having worked in the software industry, I've seen enough projects switch to restrictive licenses after they become successful that I want to be clear about my intentions with this piece of software.

This is not a legal addendum — the MIT license is the only thing that legally governs your use of this code. This section is just my promise to the people using it about how I intend to act.
