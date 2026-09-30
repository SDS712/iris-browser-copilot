"""Shared test helpers: fixture snapshots and page registration."""

import copy
import json
from pathlib import Path
from typing import Any

import httpx

from app.schemas.snapshot import PageSnapshot

FIXTURES = Path(__file__).parent / "fixtures"


def load_snapshot(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / f"{name}_snapshot.json").read_text())
    return copy.deepcopy(data)


def snapshot_model(name: str) -> PageSnapshot:
    return PageSnapshot.model_validate(load_snapshot(name))


async def register(client: httpx.AsyncClient, snapshot: dict[str, Any] | str) -> dict[str, Any]:
    body = load_snapshot(snapshot) if isinstance(snapshot, str) else snapshot
    response = await client.post("/api/pages", json={"snapshot": body})
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


async def ready_scan(client: httpx.AsyncClient, page_id: str, exclude: str = "") -> dict[str, Any]:
    """Poll the scan endpoint until the background scan finishes."""
    import asyncio

    for _ in range(200):
        params = {"exclude_keys": exclude} if exclude else {}
        response = await client.get(f"/api/pages/{page_id}/scan", params=params)
        assert response.status_code == 200, response.text
        scan: dict[str, Any] = response.json()
        if scan["status"] != "pending":
            return scan
        await asyncio.sleep(0.01)
    raise AssertionError("scan never finished")
