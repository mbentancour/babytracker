"""Binary sensor platform — exposes a simple "active timer" indicator per child."""
from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, SENSOR_ACTIVE_TIMER
from .coordinator import BabyTrackerCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: BabyTrackerCoordinator = hass.data[DOMAIN][entry.entry_id]
    entities = [ActiveTimerBinarySensor(coordinator, c["id"]) for c in coordinator.data.children]
    async_add_entities(entities)


class ActiveTimerBinarySensor(CoordinatorEntity[BabyTrackerCoordinator], BinarySensorEntity):
    """On while any timer is running for this child."""

    _attr_has_entity_name = True
    _attr_translation_key = SENSOR_ACTIVE_TIMER

    def __init__(self, coordinator: BabyTrackerCoordinator, child_id: int) -> None:
        super().__init__(coordinator)
        self._child_id = child_id
        self._attr_name = "Active timer"
        self._attr_unique_id = f"child{child_id}_active_timer"

    @property
    def _snapshot(self):
        return self.coordinator.data.snapshots.get(self._child_id)

    @property
    def is_on(self) -> bool:
        snap = self._snapshot
        return bool(snap and snap.active_timer)

    @property
    def extra_state_attributes(self):
        snap = self._snapshot
        if not snap or not snap.active_timer:
            return None
        t = snap.active_timer
        return {"name": t.get("name"), "start": t.get("start")}

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
