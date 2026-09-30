"""Site trust: look-alike names, the verdict table, reasons and local addresses."""

import httpx
import pytest

from app.services.lookalike import brand_domains, check
from app.services.tools.site_trust import TrustFacts, is_local, reasons, verdict


def facts(**changes: object) -> TrustFacts:
    base: dict[str, object] = {
        "domain": "example.com",
        "age_days": 4000,
        "official": False,
        "similar_to": None,
        "reports": 0,
        "reports_checked": True,
    }
    base.update(changes)
    return TrustFacts(**base)  # type: ignore[arg-type]


def test_brand_list_size() -> None:
    assert 140 <= len(brand_domains()) <= 170
    assert "hdfcbank.com" in brand_domains()


@pytest.mark.parametrize(
    ("domain", "label", "similar_to"),
    [
        ("hdfcbnak.com", "hdfcbnak", "hdfcbank.com"),  # edit distance 2
        ("flipkartt.com", "flipkartt", "flipkart.com"),  # edit distance 1
        ("paypa1.com", "paypa1", "paypal.com"),  # 1 → l
        ("arnazon.in", "arnazon", "amazon.in"),  # rn → m
        ("hdfcbank-secure-login.xyz", "hdfcbank-secure-login", "hdfcbank.com"),  # hyphenated
        ("hdfcbank.co", "hdfcbank", "hdfcbank.com"),  # same name, other ending
    ],
)
def test_lookalikes(domain: str, label: str, similar_to: str) -> None:
    result = check(domain, label)
    assert result.official is False
    assert result.similar_to == similar_to


def test_official_and_unrelated() -> None:
    assert check("hdfcbank.com", "hdfcbank").official is True
    unrelated = check("gardening-notes.org", "gardening-notes")
    assert unrelated == type(unrelated)(official=False, similar_to=None)
    # Short names aren't fuzzy-matched: "sbx" isn't a look-alike of "sbi".
    assert check("sbx.in", "sbx").similar_to is None


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"official": True}, "looks_ok"),
        ({"official": True, "reports": 1}, "be_careful"),
        ({"official": True, "reports": 2}, "likely_unsafe"),
        ({"similar_to": "hdfcbank.com"}, "likely_unsafe"),
        ({"reports": 2}, "likely_unsafe"),
        ({"age_days": 10, "reports": 1}, "likely_unsafe"),
        ({"age_days": 10}, "be_careful"),
        ({"age_days": 179}, "be_careful"),
        ({"age_days": 400, "reports": 1}, "be_careful"),
        ({"age_days": None}, "be_careful"),
        ({"age_days": 180}, "looks_ok"),
        ({"age_days": 4000}, "looks_ok"),
    ],
)
def test_verdict_table(changes: dict[str, object], expected: str) -> None:
    assert verdict(facts(**changes)) == expected


def test_reasons() -> None:
    young = reasons(facts(age_days=4))
    assert [(r.text, r.level) for r in young] == [
        ("Domain registered 4 days ago", "bad"),
        ("No scam reports found", "good"),
    ]
    old = reasons(facts(age_days=4100, similar_to="hdfcbank.com", reports=3))
    assert [(r.text, r.level) for r in old] == [
        ("Looks a lot like hdfcbank.com", "bad"),
        ("Registered 11 years ago", "good"),
        ("3 public reports of fraud", "bad"),
    ]
    unknown = reasons(facts(age_days=None, reports_checked=False))
    assert [r.level for r in unknown] == ["warn", "warn"]


@pytest.mark.parametrize(
    "host",
    ["localhost", "app.localhost", "192.168.1.10", "10.0.0.2", "::1", "printer.local", "intranet"],
)
def test_local_hosts(host: str) -> None:
    assert is_local(host)


def test_public_host_is_not_local() -> None:
    assert not is_local("www.hdfcbank.com")


async def trust(client: httpx.AsyncClient, url: str) -> dict[str, object]:
    response = await client.post("/api/tools/site-trust", json={"url": url})
    assert response.status_code == 200, response.text
    result: dict[str, object] = response.json()
    return result


async def test_official_site(client: httpx.AsyncClient) -> None:
    result = await trust(client, "https://www.hdfcbank.com/personal/pay?x=1")
    card = result["card"]
    assert isinstance(card, dict)
    assert card["verdict"] == "looks_ok"
    assert card["domain"] == "hdfcbank.com"
    assert card["checks_line"] == "Checks: domain age, look-alike names, public reports."
    assert result["say"] == (
        "This looks like the official hdfcbank.com site, and I didn't find any scam reports. "
        "Want the details?"
    )


async def test_new_domain(client: httpx.AsyncClient) -> None:
    result = await trust(client, "https://quick-loans-now.xyz/apply")
    card = result["card"]
    assert isinstance(card, dict)
    assert card["verdict"] == "be_careful"
    assert result["say"] == (
        "This site's domain is only 3 days old, which is a reason to be careful. "
        "I didn't find any scam reports. Want the details?"
    )


async def test_lookalike_site(client: httpx.AsyncClient) -> None:
    result = await trust(client, "hdfcbank-secure-login.xyz")
    card = result["card"]
    assert isinstance(card, dict)
    assert card["verdict"] == "likely_unsafe"
    assert "looks a lot like hdfcbank.com" in str(result["say"])


async def test_local_address(client: httpx.AsyncClient) -> None:
    result = await trust(client, "http://localhost:4321/demo/checkout")
    card = result["card"]
    assert isinstance(card, dict)
    assert card["verdict"] == "be_careful"
    assert result["say"] == "This is a local or private address, so I can't check it."


async def test_trust_is_cached_by_domain(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    await trust(client, "https://quick-loans-now.xyz/a")
    await trust(client, "https://www.quick-loans-now.xyz/b")
    assert await app.state.services.ledger.search_credits_since(0) == 1


async def test_reports_count_from_the_model(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    from app.services.llm_tasks import ScamReports

    async def two_reports(task):  # type: ignore[no-untyped-def]
        return ScamReports(fraud_report_indexes=[0, 1, 7])

    app.state.services.llm.complete = two_reports
    result = await trust(client, "https://reported.example.net")
    card = result["card"]
    assert isinstance(card, dict)
    assert card["verdict"] == "likely_unsafe"
    assert len(result["sources"]) == 2  # type: ignore[arg-type]


async def test_bad_url(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/tools/site-trust", json={"url": "https://"})
    assert response.status_code == 400


def test_say_never_claims_an_unchecked_report_search() -> None:
    from app.services.templates import trust_say

    say = trust_say(
        "looks_ok",
        domain="hdfcbank.com",
        age_days=10000,
        official=True,
        similar_to=None,
        reports=0,
        reports_checked=False,
    )
    assert say == (
        "This looks like the official hdfcbank.com site. I couldn't check for public reports "
        "right now. Want the details?"
    )
    older = trust_say(
        "looks_ok",
        domain="example.com",
        age_days=800,
        official=False,
        similar_to=None,
        reports=0,
        reports_checked=False,
    )
    assert "scam reports" not in older


def test_a_public_ip_is_not_local() -> None:
    assert not is_local("8.8.8.8")


async def test_a_bare_public_ip_is_worth_being_careful_about(client: httpx.AsyncClient) -> None:
    result = await trust(client, "http://8.8.8.8/login")
    card = result["card"]
    assert isinstance(card, dict)
    assert card["verdict"] == "be_careful"
    assert card["domain"] == "8.8.8.8"
    assert "bare IP number" in str(result["say"])
