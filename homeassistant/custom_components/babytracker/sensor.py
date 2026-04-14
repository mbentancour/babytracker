"""Sensor platform for BabyTracker."""
from __future__ import annotations

from datetime import datetime

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    DOMAIN,
    SENSOR_DIAPERS_TODAY,
    SENSOR_FEEDING_VOLUME_TODAY,
    SENSOR_FEEDINGS_TODAY,
    SENSOR_LAST_DIAPER,
    SENSOR_LAST_FEEDING,
    SENSOR_LAST_SLEEP,
    SENSOR_SLEEP_HOURS_TODAY,
)
from .coordinator import BabyTrackerCoordinator


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up sensors for every child known to the coordinator."""
    coordinator: BabyTrackerCoordinator = hass.data[DOMAIN][entry.entry_id]
    entities: list[SensorEntity] = []
    for child in coordinator.data.children:
        cid = child["id"]
        entities.extend([
            LastFeedingSensor(coordinator, cid),
            LastSleepSensor(coordinator, cid),
            LastDiaperSensor(coordinator, cid),
            FeedingsTodaySensor(coordinator, cid),
            FeedingVolumeTodaySensor(coordinator, cid),
            SleepHoursTodaySensor(coordinator, cid),
            DiapersTodaySensor(coordinator, cid),
        ])
    async_add_entities(entities)


class _ChildSensor(CoordinatorEntity[BabyTrackerCoordinator], SensorEntity):
    """Base for per-child sensors. One device per child."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: BabyTrackerCoordinator, child_id: int, key: str) -> None:
        super().__init__(coordinator)
        self._child_id = child_id
        self._key = key
        self._attr_unique_id = f"{coordinator.config_entry.entry_id if hasattr(coordinator, 'config_entry') else ''}_child{child_id}_{key}"

    @property
    def _snapshot(self):
        return self.coordinator.data.snapshots.get(self._child_id)

    @property
    def device_info(self) -> DeviceInfo:
        snap = self._snapshot
        name = snap.child.get("first_name") if snap else f"Child {self._child_id}"
        return DeviceInfo(
            identifiers={(DOMAIN, f"child-{self._child_id}")},
            name=name,
            manufacturer="BabyTracker",
            model="Child",
        )


class LastFeedingSensor(_ChildSensor):
    _attr_translation_key = SENSOR_LAST_FEEDING
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator, child_id):
        super().__init__(coordinator, child_id, SENSOR_LAST_FEEDING)
        self._attr_name = "Last feeding"

    @property
    def native_value(self):
        snap = self._snapshot
        return _parse_iso(snap.last_feeding.get("start")) if snap and snap.last_feeding else None

    @property
    def extra_state_attributes(self):
        snap = self._snapshot
        if not snap or not snap.last_feeding:
            return None
        f = snap.last_feeding
        return {
            "type": f.get("type"),
            "method": f.get("method"),
            "amount": f.get("amount"),
            "end": f.get("end"),
        }


class LastSleepSensor(_ChildSensor):
    _attr_translation_key = SENSOR_LAST_SLEEP
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator, child_id):
        super().__init__(coordinator, child_id, SENSOR_LAST_SLEEP)
        self._attr_name = "Last sleep"

    @property
    def native_value(self):
        snap = self._snapshot
        return _parse_iso(snap.last_sleep.get("start")) if snap and snap.last_sleep else None

    @property
    def extra_state_attributes(self):
        snap = self._snapshot
        if not snap or not snap.last_sleep:
            return None
        s = snap.last_sleep
        return {"end": s.get("end"), "nap": s.get("nap")}


class LastDiaperSensor(_ChildSensor):
    _attr_translation_key = SENSOR_LAST_DIAPER
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, coordinator, child_id):
        super().__init__(coordinator, child_id, SENSOR_LAST_DIAPER)
        self._attr_name = "Last diaper"

    @property
    def native_value(self):
        snap = self._snapshot
        return _parse_iso(snap.last_diaper.get("time")) if snap and snap.last_diaper else None

    @property
    def extra_state_attributes(self):
        snap = self._snapshot
        if not snap or not snap.last_diaper:
            return None
        d = snap.last_diaper
        return {"wet": d.get("wet"), "solid": d.get("solid"), "color": d.get("color")}


class FeedingsTodaySensor(_ChildSensor):
    _attr_translation_key = SENSOR_FEEDINGS_TODAY
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_native_unit_of_measurement = "feedings"

    def __init__(self, coordinator, child_id):
        super().__init__(coordinator, child_id, SENSOR_FEEDINGS_TODAY)
        self._attr_name = "Feedings today"

    @property
    def native_value(self):
        snap = self._snapshot
        return snap.feedings_today if snap else 0


class FeedingVolumeTodaySensor(_ChildSensor):
    _attr_translation_key = SENSOR_FEEDING_VOLUME_TODAY
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_native_unit_of_measurement = "mL"

    def __init__(self, coordinator, child_id):
        super().__init__(coordinator, child_id, SENSOR_FEEDING_VOLUME_TODAY)
        self._attr_name = "Feeding volume today"

    @property
    def native_value(self):
        snap = self._snapshot
        return round(snap.feeding_volume_today, 1) if snap else 0


class SleepHoursTodaySensor(_ChildSensor):
    _attr_translation_key = SENSOR_SLEEP_HOURS_TODAY
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_native_unit_of_measurement = "h"

    def __init__(self, coordinator, child_id):
        super().__init__(coordinator, child_id, SENSOR_SLEEP_HOURS_TODAY)
        self._attr_name = "Sleep today"

    @property
    def native_value(self):
        snap = self._snapshot
        return round(snap.sleep_minutes_today / 60, 2) if snap else 0


class DiapersTodaySensor(_ChildSensor):
    _attr_translation_key = SENSOR_DIAPERS_TODAY
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_native_unit_of_measurement = "diapers"

    def __init__(self, coordinator, child_id):
        super().__init__(coordinator, child_id, SENSOR_DIAPERS_TODAY)
        self._attr_name = "Diapers today"

    @property
    def native_value(self):
        snap = self._snapshot
        return snap.diapers_today if snap else 0
