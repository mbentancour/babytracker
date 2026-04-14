"""BabyTracker Home Assistant integration."""
from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import BabyTrackerClient
from .const import CONF_TOKEN, CONF_URL, CONF_VERIFY_SSL, DOMAIN
from .coordinator import BabyTrackerCoordinator

_LOGGER = logging.getLogger(__name__)
PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.BINARY_SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up BabyTracker from a config entry."""
    session = async_get_clientsession(hass)
    client = BabyTrackerClient(
        session=session,
        url=entry.data[CONF_URL],
        token=entry.data[CONF_TOKEN],
        verify_ssl=entry.data.get(CONF_VERIFY_SSL, True),
    )

    coordinator = BabyTrackerCoordinator(hass, client)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload_ok
