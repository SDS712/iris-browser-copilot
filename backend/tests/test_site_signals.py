"""Signs a site deserves a trust check, returned by POST /api/pages."""

from typing import Any

import httpx

from app.schemas.snapshot import PageSnapshot
from app.services.site_signals import site_signals
from tests.helpers import load_snapshot, register

PASSWORD = {
    "id": "i-90",
    "label": "Password",
    "type": "password",
    "required": True,
    "placeholder": None,
    "help_text": None,
    "section": None,
    "options": [],
    "filled": False,
    "sensitive": True,
}


def page(url: str, title: str = "Sign in", login: bool = True) -> PageSnapshot:
    data: dict[str, Any] = load_snapshot("form")
    data.update(url=url, title=title)
    if login:
        data["fields"] = [*data["fields"], PASSWORD]
    return PageSnapshot.model_validate(data)


def test_a_bare_ip_without_https() -> None:
    assert site_signals(page("http://8.8.8.8/login")) == ["ip_host", "no_https"]


def test_a_look_alike_domain() -> None:
    assert site_signals(page("https://hdfcbank-secure-login.xyz/")) == ["lookalike:hdfcbank.com"]


def test_a_page_naming_a_bank_on_another_domain() -> None:
    signals = site_signals(page("https://verify-account.co/", title="ICICIBank NetBanking login"))
    assert signals == ["brand_mismatch:icicibank.com"]
    # The same page without a login or payment form is just a page that names a bank.
    plain = page("https://verify-account.co/", title="ICICIBank NetBanking login", login=False)
    assert site_signals(plain) == []


def test_ordinary_official_and_local_sites_give_none() -> None:
    assert site_signals(page("https://www.icicibank.com/", title="ICICIBank NetBanking")) == []
    assert site_signals(page("https://shop.example/checkout")) == []
    assert site_signals(page("http://localhost:4321/demo/apply")) == []
    assert site_signals(page("http://192.168.1.4/router")) == []


async def test_registration_returns_the_signals(client: httpx.AsyncClient) -> None:
    snapshot = load_snapshot("form")
    snapshot["url"] = "http://8.8.8.8/apply"
    result = await register(client, snapshot)
    assert result["site_signals"] == ["ip_host", "no_https"]
    ordinary = await register(client, "form")
    assert ordinary["site_signals"] == []
