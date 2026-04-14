"""Data update coordinator that polls BabyTracker for all configured children."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import AuthError, BabyTrackerClient, BabyTrackerError
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)


@dataclass
class ChildSnapshot:
    """Aggregated state for one child."""

    child: dict
    last_feeding: dict | None = None
    last_sleep: dict | None = None
    last_diaper: dict | None = None
    feedings_today: int = 0
    feeding_volume_today: float = 0.0
    sleep_minutes_today: int = 0
    diapers_today: int = 0
    active_timer: dict | None = None


@dataclass
class BabyTrackerData:
    """Top-level data returned by the coordinator."""

    children: list[dict] = field(default_factory=list)
    snapshots: dict[int, ChildSnapshot] = field(default_factory=dict)


def _start_of_today_utc() -> datetime:
    now = datetime.now(timezone.utc).astimezone()
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(timezone.utc)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # Backend emits RFC3339; Python 3.11+ handles "Z" suffix
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _duration_minutes(item: dict, start_field: str = "start", end_field: str = "end") -> int:
    start = _parse_iso(item.get(start_field))
    end = _parse_iso(item.get(end_field))
    if not start or not end:
        return 0
    return max(0, int((end - start).total_seconds() // 60))


class BabyTrackerCoordinator(DataUpdateCoordinator[BabyTrackerData]):
    """Polls BabyTracker on a fixed interval."""

    def __init__(self, hass: HomeAssistant, client: BabyTrackerClient) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=DEFAULT_SCAN_INTERVAL,
        )
        self.client = client

    async def _async_update_data(self) -> BabyTrackerData:
        try:
            children = await self.client.list_children()
            timers = await self.client.list_timers()

            today_start = _start_of_today_utc()
            snapshots: dict[int, ChildSnapshot] = {}

            for child in children:
                cid = child["id"]
                feedings = await self.client.list_feedings(cid, limit=100)
                sleeps = await self.client.list_sleep(cid, limit=100)
                changes = await self.client.list_changes(cid, limit=100)

                snap = ChildSnapshot(child=child)
                snap.last_feeding = feedings[0] if feedings else None
                snap.last_sleep = sleeps[0] if sleeps else None
                snap.last_diaper = changes[0] if changes else None

                for f in feedings:
                    start = _parse_iso(f.get("start"))
                    if start and start >= today_start:
                        snap.feedings_today += 1
                        amount = f.get("amount")
                        if isinstance(amount, (int, float)):
                            snap.feeding_volume_today += float(amount)
                for s in sleeps:
                    start = _parse_iso(s.get("start"))
                    if start and start >= today_start:
                        snap.sleep_minutes_today += _duration_minutes(s)
                for d in changes:
                    t = _parse_iso(d.get("time"))
                    if t and t >= today_start:
                        snap.diapers_today += 1

                # First running timer for this child (most setups have ≤1 at a time)
                snap.active_timer = next((t for t in timers if t.get("child") == cid), None)
                snapshots[cid] = snap

            return BabyTrackerData(children=children, snapshots=snapshots)
        except AuthError as err:
            raise UpdateFailed(f"authentication error: {err}") from err
        except BabyTrackerError as err:
            raise UpdateFailed(str(err)) from err
