"""Domain registration dates from RDAP. Any failure means 'unknown'."""

import logging
from datetime import datetime
from typing import Any, Protocol

import httpx

logger = logging.getLogger("iris.rdap")

RDAP_URL = "https://rdap.org/domain/{domain}"


class RdapClient(Protocol):
    async def registration_date(self, domain: str) -> datetime | None: ...


def rdap_http_client() -> httpx.AsyncClient:
    # rdap.org redirects to the registry's own RDAP server.
    return httpx.AsyncClient(
        timeout=6.0, follow_redirects=True, headers={"Accept": "application/rdap+json"}
    )


def parse_registration(body: Any) -> datetime | None:
    events = body.get("events") if isinstance(body, dict) else None
    if not isinstance(events, list):
        return None
    for event in events:
        if isinstance(event, dict) and event.get("eventAction") == "registration":
            try:
                return datetime.fromisoformat(str(event.get("eventDate")))
            except ValueError:
                return None
    return None


class HttpRdapClient:
    def __init__(self, http: httpx.AsyncClient) -> None:
        self.http = http

    async def registration_date(self, domain: str) -> datetime | None:
        try:
            response = await self.http.get(RDAP_URL.format(domain=domain))
            response.raise_for_status()
            return parse_registration(response.json())
        except (httpx.HTTPError, ValueError):
            logger.warning("rdap lookup failed", extra={"iris": {"upstream": "rdap"}})
            return None
