"""Every endpoint in fake mode through ASGITransport, plus the error envelope."""

import httpx


async def test_health(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "contract_version": 1,
        "status": "ok",
        "version": "1.0.0",
        "service": {"open": True, "reason": None},
    }
    assert response.headers["x-request-id"]


async def test_request_id_is_echoed(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health", headers={"X-Request-ID": "abc-123"})
    assert response.headers["x-request-id"] == "abc-123"


async def test_wrong_contract_header_is_rejected(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/health", headers={"X-Iris-Contract": "2"})
    assert response.status_code == 400
    body = response.json()
    assert body["contract_version"] == 1
    assert body["error"]["code"] == "invalid_request"
    assert body["error"]["agent_message"]


async def test_unknown_route_uses_envelope(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "invalid_request"


async def test_oversized_body_is_rejected(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/pages",
        content=b"{" + b" " * (451 * 1024) + b"}",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


async def test_cors_allows_listed_origin_only(client: httpx.AsyncClient) -> None:
    preflight = {"Access-Control-Request-Method": "POST"}
    allowed = await client.options(
        "/api/health", headers={"Origin": "https://iris.example.com", **preflight}
    )
    assert allowed.headers.get("access-control-allow-origin") == "https://iris.example.com"
    denied = await client.options(
        "/api/health", headers={"Origin": "https://evil.example.com", **preflight}
    )
    assert "access-control-allow-origin" not in denied.headers


async def test_kill_switch_shows_in_health(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    app.state.settings.kill_switch = True
    response = await client.get("/api/health")
    assert response.json()["service"] == {"open": False, "reason": "paused"}


async def test_voice_token_in_fake_mode(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    response = await client.get("/api/voice-token")
    assert response.status_code == 200
    assert response.json() == {
        "contract_version": 1,
        "token": "fake-token",
        "expires_in_seconds": 300,
        "max_session_seconds": 600,
    }
    reserved = await app.state.services.ledger.reserved_since(0)
    assert reserved == 0.75


async def test_voice_token_refused_when_paused(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    app.state.settings.kill_switch = True
    response = await client.get("/api/voice-token")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_closed"


async def test_register_checkout_page(client: httpx.AsyncClient) -> None:
    from tests.helpers import register

    page = await register(client, "checkout")
    assert page["contract_version"] == 1
    assert page["page_id"].startswith("pg_")
    assert len(page["page_id"]) == 19
    assert page["page_type"] == "checkout"
    assert page["summary_for_agent"].startswith("PAGE: Checkout")
    assert page["scan"]["kind"] == "checkout"


async def test_page_types(client: httpx.AsyncClient) -> None:
    from tests.helpers import register

    for name, expected in [
        ("terms", "terms"),
        ("privacy", "privacy"),
        ("offer", "offer"),
        ("form", "form"),
        ("checkout", "checkout"),
    ]:
        assert (await register(client, name))["page_type"] == expected, name


async def test_each_registration_gets_a_new_id(client: httpx.AsyncClient) -> None:
    from tests.helpers import register

    first = await register(client, "offer")
    second = await register(client, "offer")
    assert first["page_id"] != second["page_id"]


async def test_scan_status_for_unknown_page(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/pages/pg_missing/scan")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "page_not_found"


async def test_page_expires_after_30_minutes(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    from tests.helpers import register

    store = app.state.services.pages
    now = [1000.0]
    store.clock = lambda: now[0]
    page = await register(client, "offer")
    now[0] += 29 * 60
    assert (await client.get(f"/api/pages/{page['page_id']}/scan")).status_code == 200
    now[0] += 29 * 60  # still alive: the last GET touched it
    assert (await client.get(f"/api/pages/{page['page_id']}/scan")).status_code == 200
    now[0] += 31 * 60
    response = await client.get(f"/api/pages/{page['page_id']}/scan")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "page_not_found"


async def test_scan_ready_from_client_flags(client: httpx.AsyncClient) -> None:
    from tests.helpers import register

    page = await register(client, "form")
    assert page["scan"] == {"status": "ready", "kind": "general"}
    scan = (await client.get(f"/api/pages/{page['page_id']}/scan")).json()
    assert scan["status"] == "ready"
    assert scan["kind"] == "general"
    assert scan["counts"] == {"high": 0, "medium": 1, "info": 0}
    assert scan["risks"][0]["title"] == "Marketing messages already ticked"


async def test_scan_none_without_flags(client: httpx.AsyncClient) -> None:
    from tests.helpers import load_snapshot, register

    snapshot = load_snapshot("form")
    snapshot["client_flags"] = []
    page = await register(client, snapshot)
    assert page["scan"] == {"status": "none", "kind": None}
    scan = (await client.get(f"/api/pages/{page['page_id']}/scan")).json()
    assert scan["status"] == "none"
    assert scan["risks"] == []
    assert scan["nudge"] is None
