"""The suite runs with the network blocked (see conftest.block_network)."""

import socket

import httpx
import pytest

from tests.conftest import NetworkBlockedError


def test_sockets_are_blocked() -> None:
    with pytest.raises(NetworkBlockedError):
        socket.create_connection(("example.com", 443))


async def test_real_http_is_blocked() -> None:
    async with httpx.AsyncClient() as http:
        with pytest.raises((NetworkBlockedError, httpx.HTTPError)):
            await http.get("https://example.com/")
