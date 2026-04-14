"""Thin async wrapper around the BabyTracker REST API."""
from __future__ import annotations

from typing import Any

import aiohttp
from aiohttp import ClientError, ClientTimeout


class BabyTrackerError(Exception):
    """Generic API error."""


class AuthError(BabyTrackerError):
    """Authentication failed."""


class BabyTrackerClient:
    """Minimal client — just what the integration needs."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        url: str,
        token: str,
        verify_ssl: bool = True,
    ) -> None:
        self._session = session
        # Strip trailing slash for predictable joining
        self._base = url.rstrip("/")
        self._token = token
        self._verify_ssl = verify_ssl

    async def _get(self, path: str, params: dict | None = None) -> Any:
        headers = {"Authorization": f"Token {self._token}"}
        url = f"{self._base}{path}"
        try:
            async with self._session.get(
                url,
                headers=headers,
                params=params,
                timeout=ClientTimeout(total=10),
                ssl=self._verify_ssl,
            ) as resp:
                if resp.status == 401 or resp.status == 403:
                    raise AuthError(f"authentication failed ({resp.status})")
                if resp.status >= 400:
                    text = await resp.text()
                    raise BabyTrackerError(f"HTTP {resp.status}: {text[:200]}")
                return await resp.json()
        except ClientError as err:
            raise BabyTrackerError(f"connection error: {err}") from err

    async def list_children(self) -> list[dict]:
        data = await self._get("/api/children/")
        return data.get("results", [])

    async def list_feedings(self, child_id: int, limit: int = 50) -> list[dict]:
        data = await self._get(
            "/api/feedings/",
            params={"child": child_id, "limit": limit, "ordering": "-start"},
        )
        return data.get("results", [])

    async def list_sleep(self, child_id: int, limit: int = 50) -> list[dict]:
        data = await self._get(
            "/api/sleep/",
            params={"child": child_id, "limit": limit, "ordering": "-start"},
        )
        return data.get("results", [])

    async def list_changes(self, child_id: int, limit: int = 50) -> list[dict]:
        data = await self._get(
            "/api/changes/",
            params={"child": child_id, "limit": limit, "ordering": "-time"},
        )
        return data.get("results", [])

    async def list_timers(self) -> list[dict]:
        data = await self._get("/api/timers/")
        return data.get("results", [])

    async def get_config(self) -> dict:
        """Lightweight endpoint useful as an auth test."""
        return await self._get("/api/config")
