# BabyTracker — Home Assistant Custom Integration

A native Home Assistant integration that exposes data from your BabyTracker
instance as sensors. Use these in dashboards, automations, and notifications.

## What you get

For each child, the integration creates a device with these entities:

| Entity                        | Type            | Description                                  |
| ----------------------------- | --------------- | -------------------------------------------- |
| `sensor.<name>_last_feeding`  | timestamp       | When the last feeding started                |
| `sensor.<name>_last_sleep`    | timestamp       | When the last sleep started                  |
| `sensor.<name>_last_diaper`   | timestamp       | When the last diaper change happened         |
| `sensor.<name>_feedings_today`| count           | Number of feedings since midnight            |
| `sensor.<name>_feeding_volume_today` | mL       | Total fed volume today                       |
| `sensor.<name>_sleep_today`   | hours           | Total sleep today                            |
| `sensor.<name>_diapers_today` | count           | Number of diapers today                      |
| `binary_sensor.<name>_active_timer` | on/off    | On while a timer is running for this child   |

Polls BabyTracker every 60 seconds.

## Installation

### HACS (recommended, once published)

Coming soon. The integration follows the standard custom-components layout
and works out of the box once HACS supports it.

### Manual

1. Copy the `custom_components/babytracker/` folder into your Home Assistant
   `config/custom_components/` directory.
2. Restart Home Assistant.
3. Go to **Settings → Devices & Services → Add Integration** and search for
   "BabyTracker".

## Setup

You'll be asked for:

- **URL** — Your BabyTracker URL, e.g. `https://babytracker.local:8099` or
  the IP/port if on a server. Include scheme (`http://` or `https://`).
- **API token** — In BabyTracker, go to **Settings → Integrations → API
  Tokens** and create one. Read-only is enough for sensors.
- **Verify SSL** — Uncheck this if your BabyTracker uses a self-signed
  certificate (the default for the Pi appliance image).

## Example automations

### Notify when it's been more than 4 hours since the last feeding

```yaml
automation:
  - alias: "Feeding overdue"
    trigger:
      - platform: template
        value_template: >-
          {{ (now() - states('sensor.lily_last_feeding') | as_datetime).total_seconds() > 4 * 3600 }}
    action:
      - service: notify.mobile_app_phone
        data:
          message: "It's been over 4 hours since Lily's last feeding"
```

### Turn on a nightlight while a sleep timer is running

```yaml
automation:
  - alias: "Nightlight while sleeping"
    trigger:
      - platform: state
        entity_id: binary_sensor.lily_active_timer
        to: "on"
    condition:
      - condition: template
        value_template: >-
          {{ state_attr('binary_sensor.lily_active_timer', 'name') | lower in ['sleep', 'nap'] }}
    action:
      - service: light.turn_on
        target: { entity_id: light.nursery_nightlight }
```

## Troubleshooting

- **"Cannot connect"** — Check that the URL is reachable from your HA host.
  If using `babytracker.local`, mDNS resolution must work between the two.
  Try the IP address instead.
- **"Authentication failed"** — Token may have been revoked. Regenerate in
  BabyTracker → Settings → Integrations → API Tokens.
- **Self-signed certificates** — Uncheck "Verify SSL" during setup. The
  Pi appliance image ships with a self-signed cert by default.

## How it differs from the BabyTracker HA add-on

- The **add-on** runs BabyTracker itself inside Home Assistant.
- This **integration** connects to a BabyTracker instance (running anywhere)
  and surfaces its data as Home Assistant entities.

You can use both: install the add-on to run BabyTracker locally on your HA
box, then install this integration on top so your dashboards and automations
have access to the data.
