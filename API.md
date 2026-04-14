# BabyTracker API Documentation

Base URL: `http://<host>:8099/api`

## Authentication

All API endpoints require authentication. Two methods are supported:

### JWT Bearer Token (for browser/frontend)

```
POST /api/auth/login
Content-Type: application/json

{"username": "admin", "password": "yourpassword"}
```

Response:
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 900
}
```

Use in requests:
```
Authorization: Bearer <access_token>
```

### API Token (for integrations)

Create a token in Settings > Data > API Tokens, or via the API:

```
POST /api/tokens/
Authorization: Bearer <admin_token>
Content-Type: application/json

{"name": "Home Assistant", "permissions": "read_write"}
```

Response includes a `token` field — save it, it's only shown once.

Use in requests:
```
Authorization: Token <token>
```

Permissions: `read` (GET only) or `read_write` (all methods).

---

## Display Control (Picture Frame / Slideshow)

Control the picture frame slideshow mode on connected browser clients. Designed for Home Assistant and similar automation tools.

### How it works

1. Each browser connects to an SSE (Server-Sent Events) stream
2. Browsers register with a **device name** (set in Settings > General > Device Name)
3. The API can target all devices or a specific device by name
4. Commands are pushed in real time — no polling, no page refresh

### List connected devices

```
GET /api/display
Authorization: Token <token>
```

Response:
```json
{
  "connected_devices": ["nursery-tablet", "kitchen-screen"]
}
```

### Start slideshow

Target all devices:
```
PUT /api/display
Authorization: Token <token>
Content-Type: application/json

{"picture_frame": true}
```

Target a specific device:
```
PUT /api/display
Authorization: Token <token>
Content-Type: application/json

{"picture_frame": true, "device": "nursery-tablet"}
```

Response:
```json
{
  "picture_frame": true,
  "device": "nursery-tablet",
  "devices_targeted": 1
}
```

### Stop slideshow

```
PUT /api/display
Authorization: Token <token>
Content-Type: application/json

{"picture_frame": false, "device": "nursery-tablet"}
```

### URL-based slideshow (for Fully Kiosk Browser)

Navigate to this URL to start the slideshow immediately:
```
http://<host>:8099/?slideshow=true
```

Tapping the screen exits the slideshow and removes the query parameter.

### SSE stream (for custom integrations)

```
GET /api/display/events?device=<device_name>
```

This is a Server-Sent Events stream. Each message is a JSON object:
```
data: {"picture_frame": true, "device": "nursery-tablet"}
```

### Home Assistant configuration

```yaml
# rest_command in configuration.yaml
rest_command:
  babytracker_slideshow_start:
    url: "http://babytracker.local:8099/api/display"
    method: PUT
    headers:
      Authorization: "Token YOUR_API_TOKEN"
      Content-Type: "application/json"
    payload: '{"picture_frame": true, "device": "{{ device }}"}'

  babytracker_slideshow_stop:
    url: "http://babytracker.local:8099/api/display"
    method: PUT
    headers:
      Authorization: "Token YOUR_API_TOKEN"
      Content-Type: "application/json"
    payload: '{"picture_frame": false, "device": "{{ device }}"}'
```

Example automations:
```yaml
# Start slideshow when nursery lights turn off
automation:
  - alias: "Nursery slideshow on"
    trigger:
      - platform: state
        entity_id: light.nursery
        to: "off"
    action:
      - service: rest_command.babytracker_slideshow_start
        data:
          device: nursery-tablet

  # Stop slideshow on motion
  - alias: "Nursery slideshow off"
    trigger:
      - platform: state
        entity_id: binary_sensor.nursery_motion
        to: "on"
    action:
      - service: rest_command.babytracker_slideshow_stop
        data:
          device: nursery-tablet
```

---

## Data Endpoints

All data endpoints follow the same pattern and return paginated responses:

```json
{
  "count": 42,
  "next": null,
  "previous": null,
  "results": [...]
}
```

### Common query parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `child` | Filter by child ID | `?child=1` |
| `limit` | Results per page (max 1000) | `?limit=50` |
| `offset` | Skip N results | `?offset=50` |
| `ordering` | Sort field (prefix `-` for DESC) | `?ordering=-start` |
| `start_min` | Filter entries after this time | `?start_min=2026-01-01T00:00:00` |
| `start_max` | Filter entries before this time | `?start_max=2026-12-31T23:59:59` |
| `date_min` | Filter by date (for date-based entities) | `?date_min=2026-01-01` |
| `date_max` | Filter by date | `?date_max=2026-12-31` |

### Children

```
GET    /api/children/          List children
POST   /api/children/          Create child (admin only)
PATCH  /api/children/{id}/     Update child (admin only)
DELETE /api/children/{id}/     Delete child (admin only)
POST   /api/children/{id}/photo  Upload child photo
```

### Feedings

```
GET    /api/feedings/          List (filters: child, start_min, start_max, ordering)
POST   /api/feedings/          Create
PATCH  /api/feedings/{id}/     Update
DELETE /api/feedings/{id}/     Delete
```

Body (create):
```json
{
  "child": 1,
  "start": "2026-04-13T08:00:00",
  "end": "2026-04-13T08:15:00",
  "type": "breast milk",
  "method": "bottle",
  "amount": 120,
  "notes": ""
}
```

Types: `breast milk`, `formula`, `fortified breast milk`, `solid food`
Methods: `bottle`, `left breast`, `right breast`, `both breasts`, `parent fed`, `self fed`

With timer: send `{"child": 1, "type": "...", "method": "...", "timer": 5}` — the timer's start time is used, current time is the end, and the timer is deleted.

### Sleep

```
GET    /api/sleep/             List
POST   /api/sleep/             Create
PATCH  /api/sleep/{id}/        Update
DELETE /api/sleep/{id}/        Delete
```

Body: `{child, start, end, nap, notes}` or `{child, timer, nap}`

### Diaper Changes

```
GET    /api/changes/           List (filters: child, date_min, date_max)
POST   /api/changes/           Create
PATCH  /api/changes/{id}/      Update
DELETE /api/changes/{id}/      Delete
```

Body: `{child, time, wet, solid, color, notes}`
Colors: `""`, `black`, `brown`, `green`, `yellow`

### Tummy Time

```
GET    /api/tummy-times/       List
POST   /api/tummy-times/       Create
PATCH  /api/tummy-times/{id}/  Update
DELETE /api/tummy-times/{id}/  Delete
```

Body: `{child, start, end, milestone, notes}` or `{child, timer}`

### Temperature

```
GET    /api/temperature/       List (filters: child, date_min, date_max)
POST   /api/temperature/       Create
PATCH  /api/temperature/{id}/  Update
DELETE /api/temperature/{id}/  Delete
```

Body: `{child, time, temperature, notes}`

### Weight

```
GET    /api/weight/            List (filters: child, date_min, date_max)
POST   /api/weight/            Create
PATCH  /api/weight/{id}/       Update
DELETE /api/weight/{id}/       Delete
```

Body: `{child, date, weight, notes}`

### Height

```
GET    /api/height/            List
POST   /api/height/            Create
PATCH  /api/height/{id}/       Update
DELETE /api/height/{id}/       Delete
```

Body: `{child, date, height, notes}`

### Head Circumference

```
GET    /api/head-circumference/        List
POST   /api/head-circumference/        Create
PATCH  /api/head-circumference/{id}/   Update
DELETE /api/head-circumference/{id}/   Delete
```

Body: `{child, date, head_circumference, notes}`

### BMI

```
GET    /api/bmi/               List
POST   /api/bmi/               Create
PATCH  /api/bmi/{id}/          Update
DELETE /api/bmi/{id}/          Delete
```

Body: `{child, date, bmi, notes}`

### Pumping

```
GET    /api/pumping/           List
POST   /api/pumping/           Create
DELETE /api/pumping/{id}/      Delete
```

Body: `{child, start, end, amount}`

### Medications

```
GET    /api/medications/       List
POST   /api/medications/       Create
PATCH  /api/medications/{id}/  Update
DELETE /api/medications/{id}/  Delete
```

Body: `{child, time, name, dosage, dosage_unit, notes}`

### Milestones

```
GET    /api/milestones/        List
POST   /api/milestones/        Create
PATCH  /api/milestones/{id}/   Update
DELETE /api/milestones/{id}/   Delete
```

Body: `{child, date, title, category, description}`
Categories: `motor`, `cognitive`, `social`, `language`, `other`

### Notes

```
GET    /api/notes/             List
POST   /api/notes/             Create
PATCH  /api/notes/{id}/        Update
DELETE /api/notes/{id}/        Delete
```

Body: `{child, time, note}`

### Timers

```
GET    /api/timers/            List all active timers
POST   /api/timers/            Create
PATCH  /api/timers/{id}/       Update (e.g., change start time)
DELETE /api/timers/{id}/       Delete (discard timer)
```

Body (create): `{child, name}` — `name` is e.g. "Feeding", "Sleep", "Tummy Time"

---

## Photos

### Standalone photos (bulk upload)

```
POST /api/photos/
Authorization: Token <token>
Content-Type: multipart/form-data

child=1
photos=@photo1.jpg
photos=@photo2.jpg
```

Date is extracted from EXIF metadata automatically. Falls back to today if no EXIF data.

```
GET    /api/photos/            List standalone photos
PATCH  /api/photos/{id}/       Update caption/date
DELETE /api/photos/{id}/       Delete photo and file
```

### Entry photos

Attach a photo to any entry:
```
POST /api/{entity_type}/{id}/photo
Content-Type: multipart/form-data

photo=@image.jpg
```

Entity types: `feedings`, `sleep`, `changes`, `tummy-times`, `temperature`, `weight`, `height`, `head-circumference`, `pumping`, `medications`, `milestones`, `notes`, `bmi`, `children`

Remove a photo from an entry:
```
DELETE /api/{entity_type}/{id}/photo
```

### Photo gallery

Returns all photos (standalone + entry photos) for a child:
```
GET /api/gallery/?child=1
```

### Serving photos

```
GET /api/media/photos/{filename}
```

Requires authentication via refresh token cookie or Authorization header.

---

## Data Export

```
GET /api/export/csv?child=1&type=all
```

Types: `all`, `feedings`, `sleep`, `changes`, `weight`, `height`, `head_circumference`, `temperature`, `medications`, `milestones`

Returns a CSV file download.

---

## User Management (admin only)

### Users

```
GET    /api/users/             List all users with their access
POST   /api/users/             Create user: {username, password, is_admin}
DELETE /api/users/{id}/        Delete user
GET    /api/users/me           Get current user's info and permissions
```

### Child access

```
POST   /api/users/{id}/access              Grant access: {child_id, role_id}
DELETE /api/users/{userId}/access/{childId} Revoke access
```

### Roles

```
GET    /api/roles/                     List roles with permissions
POST   /api/roles/                     Create custom role: {name, description, permissions}
PUT    /api/roles/{id}/permissions     Update permissions: {permissions: {feature: level}}
DELETE /api/roles/{id}/                Delete custom role
```

Predefined roles: `parent` (full write), `caregiver` (write daily, read measurements), `viewer` (read only)

Permission levels: `none`, `read`, `write`

Features: `feeding`, `sleep`, `diaper`, `tummy`, `temp`, `weight`, `height`, `headcirc`, `pumping`, `bmi`, `medication`, `milestone`, `note`, `photo`

---

## Webhooks

```
GET    /api/webhooks/          List webhooks
POST   /api/webhooks/          Create: {name, url, secret, events, active}
PATCH  /api/webhooks/{id}/     Update
DELETE /api/webhooks/{id}/     Delete
```

Events: `*` (all) or comma-separated list.

---

## API Tokens

```
GET    /api/tokens/            List tokens (token value is hidden)
POST   /api/tokens/            Create: {name, permissions} — returns token once
DELETE /api/tokens/{id}/       Revoke token
```

---

## Reminders

```
GET    /api/reminders/?child=1  List reminders
POST   /api/reminders/          Create: {child, title, type, interval_minutes, fixed_time, active}
PATCH  /api/reminders/{id}/     Update
DELETE /api/reminders/{id}/     Delete
```

Types: `interval` (every N minutes) or `fixed_time`.

---

## Tags

```
GET    /api/tags/                          List all tags
POST   /api/tags/                          Create: {name, color}
PATCH  /api/tags/{id}/                     Update
DELETE /api/tags/{id}/                     Delete
GET    /api/tags/{entityType}/{entityId}/  Get tags for an entry
PUT    /api/tags/{entityType}/{entityId}/  Set tags: {tag_ids: [1, 2]}
```

---

## Configuration

```
GET /api/config
```

Public endpoint (no auth required). Returns:
```json
{
  "refresh_interval": 30,
  "demo_mode": false,
  "unit_system": "metric",
  "setup_mode": false,
  "appliance_mode": false
}
```

- `setup_mode`: true during first-boot Wi-Fi setup (Pi image only)
- `appliance_mode`: true when running as a Pi appliance (TLS configured)

---

## Backups (admin only)

```
GET    /api/backups/              List available backups
POST   /api/backups/              Create a new backup
GET    /api/backups/download?name=<filename>  Download a backup file
DELETE /api/backups/?name=<filename>          Delete a backup
```

Backups are `.tar.gz` files containing a PostgreSQL dump and all photos.

### Backup settings

```
GET /api/backups/settings
```

Response: `{"frequency": "daily"}`

```
PUT /api/backups/settings
Content-Type: application/json

{"frequency": "daily"}
```

Frequencies: `disabled`, `6h`, `12h`, `daily`, `weekly`

### Restore

```
POST /api/backups/restore
Content-Type: multipart/form-data

backup=@babytracker-backup-2026-04-14.tar.gz
```

Replaces the entire database and photos directory. Use with caution.

---

## Baby Buddy Import (admin only)

Import data from an existing Baby Buddy instance:

```
POST /api/import/babybuddy
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "url": "https://babybuddy.example.com",
  "token": "baby-buddy-api-key"
}
```

Fetches all children, feedings, sleep, changes, tummy times, temperature, weight, height, pumping, and notes via the Baby Buddy API. Handles pagination automatically.

---

## Password Management

Change your own password:
```
PUT /api/users/me/password
Content-Type: application/json

{"current_password": "old", "new_password": "new"}
```

Reset another user's password (admin only):
```
PUT /api/users/{id}/password
Content-Type: application/json

{"new_password": "new"}
```

---

## Photo Gallery

Aggregated view of all photos (standalone + entry-attached) for a child:

```
GET /api/gallery/?child=1
```

Tag a photo with a child:
```
POST /api/gallery/tag
Content-Type: application/json

{"filename": "photo-abc123.jpg", "child_id": 1}
```

---

## Domain Settings (admin only, appliance mode)

Get current custom domain:
```
GET /api/settings/domain
```

Response: `{"domain": "baby.example.com"}`

Set custom domain (enables Let's Encrypt):
```
PUT /api/settings/domain
Content-Type: application/json

{"domain": "baby.example.com"}
```

Requires DNS A record pointing to the device and port 443 forwarded. Restart required after changing.

---

## System Controls (admin only, appliance mode)

Restart the device:
```
POST /api/system/restart
```

Shut down the device:
```
POST /api/system/shutdown
```

These only work when running as a Pi appliance (appliance mode). The response is sent before the action executes.

---

## Setup (Pi first boot only)

These endpoints are only available when the device is in setup mode (first boot). They require no authentication.

```
GET  /api/setup/status          Setup status: {setup_mode, wifi_connected}
GET  /api/setup/wifi/scan       Scan for Wi-Fi networks
POST /api/setup/wifi/connect    Connect to Wi-Fi: {ssid, password}
POST /api/setup/complete        Mark setup as complete
```

Wi-Fi scan response:
```json
[
  {"ssid": "HomeNetwork", "signal": "85", "security": "WPA2"},
  {"ssid": "Neighbor", "signal": "42", "security": "WPA2"}
]
```
