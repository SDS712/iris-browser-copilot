"""Privacy rules on snapshots: no `value` keys, the size limit, sensitive placeholders."""

import json

import httpx
import pytest

from app.errors import IrisError
from app.services.page_intake import check_raw_snapshot, sanitise
from tests.helpers import load_snapshot, register, snapshot_model


async def test_value_key_is_rejected(client: httpx.AsyncClient) -> None:
    snapshot = load_snapshot("form")
    snapshot["fields"][0]["value"] = "Asha Rao"
    response = await client.post("/api/pages", json={"snapshot": snapshot})
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "invalid_request"
    assert "Asha" not in json.dumps(error)


async def test_nested_value_key_is_rejected(client: httpx.AsyncClient) -> None:
    snapshot = load_snapshot("checkout")
    snapshot["client_flags"][0]["params"]["nested"] = {"deeper": [{"value": 1}]}
    response = await client.post("/api/pages", json={"snapshot": snapshot})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_value_in_text_is_fine() -> None:
    snapshot = load_snapshot("terms")
    snapshot["sections"][0]["text"] = 'The "value": of the loan is shown below.'
    check_raw_snapshot(json.dumps({"snapshot": snapshot}).encode())


async def test_unknown_field_is_rejected(client: httpx.AsyncClient) -> None:
    snapshot = load_snapshot("form")
    snapshot["fields"][0]["typed_text"] = "secret"
    response = await client.post("/api/pages", json={"snapshot": snapshot})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    assert "secret" not in response.text


async def test_snapshot_over_400_kb_is_rejected(client: httpx.AsyncClient) -> None:
    snapshot = load_snapshot("terms")
    snapshot["sections"][0]["text"] = "x" * (405 * 1024)
    response = await client.post("/api/pages", json={"snapshot": snapshot})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_raw_limit_is_400_kb() -> None:
    with pytest.raises(IrisError) as caught:
        check_raw_snapshot(b" " * (400 * 1024 + 1))
    assert caught.value.code == "payload_too_large"


def test_sensitive_placeholders_are_forced_to_null() -> None:
    snapshot = sanitise(snapshot_model("form"))
    by_label = {field.label: field for field in snapshot.fields}
    assert by_label["Bank account number"].placeholder is None
    assert by_label["OTP"].placeholder is None
    assert by_label["PAN"].placeholder == "ABCDE1234F"


async def test_sensitive_placeholder_never_reaches_the_summary(client: httpx.AsyncClient) -> None:
    page = await register(client, "form")
    assert "Enter account number" not in page["summary_for_agent"]
    assert '"Bank account number" [sensitive] [required]' in page["summary_for_agent"]
