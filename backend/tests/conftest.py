import os

# Before any app import: tests always run in fake mode against a throwaway ledger.
os.environ["IRIS_ENV"] = "test"
os.environ["IRIS_FAKE_UPSTREAMS"] = "1"

import socket
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from app.main import create_app
from app.settings import Settings

CLIENT_IP = "203.0.113.5"


class NetworkBlockedError(RuntimeError):
    pass


@pytest.fixture(autouse=True)
def block_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Fake mode must make no network calls: any real connection attempt fails the test.

    respx mocks at the httpx transport and ASGITransport calls the app directly,
    so neither needs a socket.
    """

    def refuse(*args: Any, **kwargs: Any) -> Any:
        raise NetworkBlockedError("tests must not use the network")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    yield


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        _env_file=None,  # type: ignore[call-arg]
        iris_env="test",
        data_dir=tmp_path,
        allowed_origins=["https://iris.example.com"],
    )


@pytest.fixture
async def app(settings: Settings) -> AsyncIterator[FastAPI]:
    application = create_app(settings)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False, client=(CLIENT_IP, 1234))
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"X-Iris-Contract": "1"},
    ) as http:
        yield http
