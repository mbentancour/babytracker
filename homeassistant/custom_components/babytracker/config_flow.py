"""Config flow for BabyTracker."""
from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import AuthError, BabyTrackerClient, BabyTrackerError
from .const import CONF_TOKEN, CONF_URL, CONF_VERIFY_SSL, DOMAIN

DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_URL, default="https://babytracker.local:8099"): str,
        vol.Required(CONF_TOKEN): str,
        vol.Optional(CONF_VERIFY_SSL, default=False): bool,
    }
)


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for BabyTracker."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            url = user_input[CONF_URL].strip().rstrip("/")
            parsed = urlparse(url)
            if not parsed.scheme or not parsed.netloc:
                errors[CONF_URL] = "invalid_url"
            else:
                session = async_get_clientsession(self.hass)
                client = BabyTrackerClient(
                    session=session,
                    url=url,
                    token=user_input[CONF_TOKEN],
                    verify_ssl=user_input.get(CONF_VERIFY_SSL, True),
                )
                try:
                    await client.get_config()
                    await client.list_children()
                except AuthError:
                    errors["base"] = "invalid_auth"
                except BabyTrackerError:
                    errors["base"] = "cannot_connect"
                else:
                    # Use the host as a unique id so the same instance can't be added twice.
                    await self.async_set_unique_id(parsed.netloc)
                    self._abort_if_unique_id_configured()
                    return self.async_create_entry(
                        title=f"BabyTracker ({parsed.netloc})",
                        data={
                            CONF_URL: url,
                            CONF_TOKEN: user_input[CONF_TOKEN],
                            CONF_VERIFY_SSL: user_input.get(CONF_VERIFY_SSL, True),
                        },
                    )

        return self.async_show_form(
            step_id="user",
            data_schema=DATA_SCHEMA,
            errors=errors,
        )
