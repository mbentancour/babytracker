"""Constants for the BabyTracker integration."""
from datetime import timedelta

DOMAIN = "babytracker"

# Config entry data keys
CONF_URL = "url"
CONF_TOKEN = "token"
CONF_VERIFY_SSL = "verify_ssl"

# Polling interval — BabyTracker is local, fast, and tracks slow-changing data.
DEFAULT_SCAN_INTERVAL = timedelta(seconds=60)

# Per-child sensor keys
SENSOR_LAST_FEEDING = "last_feeding"
SENSOR_LAST_SLEEP = "last_sleep"
SENSOR_LAST_DIAPER = "last_diaper"
SENSOR_FEEDINGS_TODAY = "feedings_today"
SENSOR_FEEDING_VOLUME_TODAY = "feeding_volume_today"
SENSOR_SLEEP_HOURS_TODAY = "sleep_hours_today"
SENSOR_DIAPERS_TODAY = "diapers_today"
SENSOR_ACTIVE_TIMER = "active_timer"
