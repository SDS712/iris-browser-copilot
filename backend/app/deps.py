"""FastAPI dependencies."""

from collections.abc import Awaitable, Callable
from typing import cast

from fastapi import Request

from app.logging import hash_ip
from app.services.container import Services


def get_services(request: Request) -> Services:
    return cast(Services, request.app.state.services)


def rate_limit(bucket: str) -> Callable[[Request], Awaitable[None]]:
    """A dependency that counts the request against the client IP's limits."""

    async def check(request: Request) -> None:
        # Behind Caddy, Uvicorn's --proxy-headers puts the real client IP here.
        ip = request.client.host if request.client else "unknown"
        get_services(request).ratelimit.hit(bucket, hash_ip(ip))

    return check
