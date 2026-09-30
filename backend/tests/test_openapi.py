"""openapi.json is what the app serves (re-run scripts/export_openapi.py if not)."""

import importlib.util
import json
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parents[1]
OPENAPI = BACKEND / "openapi.json"


def exporter_render() -> str:
    spec = importlib.util.spec_from_file_location(
        "export_openapi", BACKEND / "scripts" / "export_openapi.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    rendered: str = module.render()
    return rendered


def test_committed_openapi_is_current() -> None:
    assert OPENAPI.read_text(encoding="utf-8") == exporter_render(), (
        "openapi.json is out of date: run `uv run python scripts/export_openapi.py`"
    )


async def test_served_openapi_matches(client: httpx.AsyncClient) -> None:
    served = (await client.get("/api/openapi.json")).json()
    assert served == json.loads(OPENAPI.read_text(encoding="utf-8"))
    paths = set(served["paths"])
    assert paths == {
        "/api/health",
        "/api/agent-config",
        "/api/voice-token",
        "/api/pages",
        "/api/pages/{page_id}/scan",
        "/api/tools/explain-field",
        "/api/tools/ask-page",
        "/api/journey/summary",
        "/api/tools/walkthrough",
        "/api/tools/summarize",
        "/api/tools/scan",
        "/api/tools/site-trust",
        "/api/tools/web-lookup",
        "/api/tools/loan-cost",
    }
