"""Shared helpers for calling upstream HTTP services."""

import logging
from typing import Any

import httpx

from app.errors import ErrorCode, IrisError

logger = logging.getLogger("iris.upstream")


def upstream_failure(upstream: str, status: int | None = None) -> IrisError:
    # Only the upstream's name and status: URLs can carry queries or page data.
    logger.warning("upstream failed", extra={"iris": {"upstream": upstream, "status": status}})
    return IrisError(ErrorCode.UPSTREAM_ERROR)


def upstream_timeout(upstream: str) -> IrisError:
    logger.warning("upstream timed out", extra={"iris": {"upstream": upstream}})
    return IrisError(ErrorCode.UPSTREAM_TIMEOUT)


async def request_json(
    http: httpx.AsyncClient, method: str, url: str, *, upstream: str, **kwargs: Any
) -> Any:
    """Send a request and return its JSON body, mapping every failure to an IrisError."""
    try:
        response = await http.request(method, url, **kwargs)
    except httpx.TimeoutException as exc:
        raise upstream_timeout(upstream) from exc
    except httpx.HTTPError as exc:
        raise upstream_failure(upstream) from exc
    if response.status_code >= 400:
        raise upstream_failure(upstream, response.status_code)
    try:
        return response.json()
    except ValueError as exc:
        raise upstream_failure(upstream, response.status_code) from exc
