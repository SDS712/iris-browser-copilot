"""Upstream clients against mocked HTTP (respx): AssemblyAI tokens and RDAP."""

import json

import httpx
import pytest
import respx

from app.errors import IrisError
from app.services.assemblyai import AGENTS_BASE_URL, AssemblyAIVoiceClient, agents_http_client
from app.services.rdap import HttpRdapClient, parse_registration, rdap_http_client

TOKEN_URL = f"{AGENTS_BASE_URL}/v1/token"


@respx.mock
async def test_token_request() -> None:
    route = respx.get(TOKEN_URL).mock(
        return_value=httpx.Response(200, json={"token": "tok_123", "expires_in_seconds": 300})
    )
    http = agents_http_client("secret-key")
    token = await AssemblyAIVoiceClient(http).mint_token(600)
    await http.aclose()
    assert token == "tok_123"
    request = route.calls.last.request
    assert request.headers["authorization"] == "Bearer secret-key"
    assert dict(request.url.params) == {
        "expires_in_seconds": "300",
        "max_session_duration_seconds": "600",
    }


@pytest.mark.parametrize(
    ("response", "code"),
    [
        (httpx.Response(401, json={"error": "bad key"}), "upstream_error"),
        (httpx.Response(200, json={"nope": True}), "upstream_error"),
        (httpx.Response(200, content=b"not json"), "upstream_error"),
        (httpx.ConnectTimeout("slow"), "upstream_timeout"),
        (httpx.ConnectError("down"), "upstream_error"),
    ],
)
@respx.mock
async def test_token_failures(response: httpx.Response | Exception, code: str) -> None:
    if isinstance(response, Exception):
        respx.get(TOKEN_URL).mock(side_effect=response)
    else:
        respx.get(TOKEN_URL).mock(return_value=response)
    http = agents_http_client("secret-key")
    with pytest.raises(IrisError) as caught:
        await AssemblyAIVoiceClient(http).mint_token(600)
    await http.aclose()
    assert caught.value.code == code


@respx.mock
async def test_sessions_body_must_have_a_list() -> None:
    respx.get(f"{AGENTS_BASE_URL}/v1/sessions").mock(
        return_value=httpx.Response(200, json={"items": []})
    )
    http = agents_http_client("secret-key")
    with pytest.raises(IrisError):
        await AssemblyAIVoiceClient(http).list_sessions(None)
    await http.aclose()


RDAP_BODY = {
    "events": [
        {"eventAction": "last changed", "eventDate": "2024-01-01T00:00:00Z"},
        {"eventAction": "registration", "eventDate": "1995-03-15T05:00:00Z"},
    ]
}


@respx.mock
async def test_rdap_follows_the_redirect() -> None:
    respx.get("https://rdap.org/domain/hdfcbank.com").mock(
        return_value=httpx.Response(
            302, headers={"Location": "https://rdap.verisign.com/com/v1/domain/hdfcbank.com"}
        )
    )
    respx.get("https://rdap.verisign.com/com/v1/domain/hdfcbank.com").mock(
        return_value=httpx.Response(200, content=json.dumps(RDAP_BODY))
    )
    http = rdap_http_client()
    registered = await HttpRdapClient(http).registration_date("hdfcbank.com")
    await http.aclose()
    assert registered is not None
    assert registered.year == 1995


@respx.mock
async def test_rdap_failure_means_unknown() -> None:
    respx.get("https://rdap.org/domain/nope.xyz").mock(return_value=httpx.Response(404))
    http = rdap_http_client()
    assert await HttpRdapClient(http).registration_date("nope.xyz") is None
    await http.aclose()


def test_rdap_parsing_edge_cases() -> None:
    assert (
        parse_registration({"events": [{"eventAction": "registration", "eventDate": "junk"}]})
        is None
    )
    assert parse_registration({"events": "none"}) is None
    assert parse_registration([]) is None
    assert (
        parse_registration({"events": [{"eventAction": "expiration", "eventDate": "2030-01-01"}]})
        is None
    )
