"""Scans: client flags → risks, de-duplication, sorting, IDs, nudges and failures."""

import httpx

from app.schemas.common import RiskFlag
from app.services.llm_tasks import Finding
from app.services.pages import Page, SectionIndex, prepare_sections
from app.services.scan import (
    ScanRisk,
    build_nudge,
    client_flag_risks,
    counts,
    findings_to_risks,
    merge_risks,
)
from tests.helpers import load_snapshot, ready_scan, register, snapshot_model


def make_page(name: str) -> Page:
    snapshot = snapshot_model(name)
    sections = prepare_sections(snapshot)
    return Page(
        page_id="pg_test",
        snapshot=snapshot,
        page_type="checkout",
        sections=sections,
        index=SectionIndex([]),
        content_hash="hash",
        summary_for_agent="",
    )


def text_risk(category: str, severity: str, section_id: str, amount: int | None = None) -> ScanRisk:
    return ScanRisk(
        flag=RiskFlag(
            id="",
            key=f"page_text:{category}:{section_id}",
            category=category,  # type: ignore[arg-type]
            severity=severity,
            title="Title",
            detail="Detail",
            quote="Quote",  # type: ignore[arg-type]
            section_id=section_id,
            element_ids=[],
            amount_inr=amount,
            origin="page_text",
        ),
        nudge_phrase="a phrase",
    )


def test_client_flags_become_risks() -> None:
    risks = client_flag_risks(make_page("checkout"))
    by_rule = {risk.rule: risk.flag for risk in risks}
    addon = by_rule["prechecked_paid_addon"]
    assert addon.title == "₹1,299 add-on already ticked"
    assert addon.detail == (
        "'Protect your purchase: QuickCred Shield ₹1,299/year' was ticked before you touched it."
    )
    assert addon.key == "client_rule:prechecked_paid_addon:i-20"
    assert addon.origin == "client_rule"
    assert addon.element_ids == ["i-20"]
    assert by_rule["trial_to_paid"].title == "Free trial turns into ₹199 a month"
    assert by_rule["hidden_cookie_reject"].title == "Cookie banner hides the reject option"
    assert all(len(risk.flag.title) <= 60 and len(risk.flag.detail) <= 200 for risk in risks)


def test_offer_flags() -> None:
    risks = client_flag_risks(make_page("offer"))
    titles = {risk.rule: risk.flag.title for risk in risks}
    assert titles["flat_rate_offer"] == "'1.5% a month flat' costs more than it sounds"
    assert titles["countdown_timer"] == "Countdown timer on the offer"


def test_merge_sorts_and_numbers() -> None:
    client = client_flag_risks(make_page("checkout"))
    text = [text_risk("shares_data", "medium", "s-2"), text_risk("limits_rights", "info", "s-1")]
    merged = merge_risks(client, text)
    assert [risk.flag.id for risk in merged] == ["r-1", "r-2", "r-3", "r-4", "r-5"]
    assert [risk.flag.severity for risk in merged] == ["high", "high", "medium", "info", "info"]
    # Client-rule risks come before text risks of the same severity.
    assert merged[3].flag.origin == "client_rule"
    assert counts(merged).model_dump() == {"high": 2, "medium": 1, "info": 2}


def test_text_risk_repeating_a_client_rule_is_dropped() -> None:
    client = client_flag_risks(make_page("checkout"))
    same_amount = text_risk("costs_money", "high", "s-2", amount=1299)
    other_category = text_risk("auto_debit", "high", "s-2", amount=1299)
    merged = merge_risks(client, [same_amount, other_category])
    assert [risk.flag.category for risk in merged].count("costs_money") == 1
    assert any(risk.flag.category == "auto_debit" for risk in merged)


# --- Nudges and the scan service, through the API in fake mode ---


async def test_checkout_nudge_matches_the_spec_example(client: httpx.AsyncClient) -> None:
    page = await register(client, "checkout")
    scan = await ready_scan(client, page["page_id"])
    nudge = scan["nudge"]
    assert nudge["say"] == (
        "Before you pay: a ₹1,299 add-on is already ticked, and the free trial becomes "
        "₹199 a month after 30 days. Want the details?"
    )
    assert len(nudge["say"].split()) == 23
    assert nudge["risk_keys"] == [
        "client_rule:prechecked_paid_addon:i-20",
        "client_rule:trial_to_paid:i-21",
    ]
    assert nudge["highlight_ids"] == ["i-20", "i-21"]


async def test_late_fee_gets_its_own_nudge(client: httpx.AsyncClient) -> None:
    snapshot = load_snapshot("checkout")
    snapshot["revision"] = 2
    snapshot["prices"].append(
        {
            "id": "i-35",
            "label": "Convenience fee",
            "amount_text": "₹49",
            "amount_inr": 49,
            "first_seen_revision": 2,
        }
    )
    snapshot["client_flags"].append(
        {
            "rule": "late_price",
            "category": "costs_money",
            "severity": "high",
            "element_ids": ["i-35"],
            "detail": "A fee appeared.",
            "amount_inr": 49,
            "params": {"revision": 2},
        }
    )
    page = await register(client, snapshot)
    already = "client_rule:prechecked_paid_addon:i-20,client_rule:trial_to_paid:i-21"
    scan = await ready_scan(client, page["page_id"], exclude=already)
    assert scan["nudge"]["say"] == (
        "Before you pay: a ₹49 convenience fee was just added. I've highlighted it."
    )
    assert scan["nudge"]["highlight_ids"] == ["i-35"]
    assert len(scan["risks"]) == 4  # risks always lists everything


async def test_no_nudge_once_everything_is_excluded(client: httpx.AsyncClient) -> None:
    page = await register(client, "checkout")
    keys = "client_rule:prechecked_paid_addon:i-20,client_rule:trial_to_paid:i-21"
    scan = await ready_scan(client, page["page_id"], exclude=keys)
    assert scan["nudge"] is None  # only the info-level cookie risk is left


async def test_terms_scan_finds_the_expected_categories(client: httpx.AsyncClient) -> None:
    page = await register(client, "terms")
    assert page["scan"] == {"status": "pending", "kind": "terms"}
    scan = await ready_scan(client, page["page_id"])
    assert scan["status"] == "ready"
    assert scan["kind"] == "terms"
    categories = {risk["category"] for risk in scan["risks"]}
    assert {
        "auto_debit",
        "costs_money",
        "auto_renews",
        "shares_data",
        "limits_rights",
    } <= categories
    for risk in scan["risks"]:
        assert risk["origin"] == "page_text"
        assert risk["quote"]
        assert risk["key"] == f"page_text:{risk['category']}:{risk['section_id']}"
    nudge = scan["nudge"]
    assert nudge["say"].startswith("Before you agree: this sets up an auto-debit")
    assert len(nudge["say"].split()) < 25


async def test_terms_scan_is_cached_by_content(client: httpx.AsyncClient) -> None:
    first = await register(client, "terms")
    await ready_scan(client, first["page_id"])
    second = await register(client, "terms")
    assert second["scan"] == {"status": "ready", "kind": "terms"}


async def test_offer_nudge_works_out_the_real_rate(client: httpx.AsyncClient) -> None:
    page = await register(client, "offer")
    scan = await ready_scan(client, page["page_id"])
    assert scan["nudge"]["say"] == (
        "Heads up: 1.5% a month flat is closer to 36.5% a year. Want the breakdown?"
    )


async def test_offer_nudge_without_loan_figures(client: httpx.AsyncClient) -> None:
    snapshot = load_snapshot("offer")
    snapshot["client_flags"][0]["params"] = {"rate_percent": 1.5, "rate_basis": "flat_monthly"}
    snapshot["sections"] = [
        {"id": "s-1", "heading": None, "level": None, "text": "Just 1.5% p.m. flat!"}
    ]
    snapshot["prices"] = []
    snapshot["url"] = "https://iris.example.com/demo/offer"
    page = await register(client, snapshot)
    scan = await ready_scan(client, page["page_id"])
    assert scan["nudge"]["say"] == (
        "Heads up: '1.5% a month flat' costs more than it sounds. "
        "Want me to work out the real rate?"
    )


async def test_model_failure_still_returns_client_risks(client: httpx.AsyncClient, app) -> None:  # type: ignore[no-untyped-def]
    async def broken(task):  # type: ignore[no-untyped-def]
        raise RuntimeError("model down")

    app.state.services.scans.llm.complete = broken
    page = await register(client, "checkout")
    scan = await ready_scan(client, page["page_id"])
    assert scan["status"] == "ready"
    assert scan["counts"]["high"] == 2


async def test_merge_failure_marks_scan_failed(client: httpx.AsyncClient, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import app.services.scan as scan_module

    def broken(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("bad merge")

    monkeypatch.setattr(scan_module, "merge_risks", broken)
    page = await register(client, "privacy")
    scan = await ready_scan(client, page["page_id"])
    assert scan["status"] == "failed"
    assert scan["risks"] == []


def test_unverified_findings_are_dropped() -> None:
    page = make_page("checkout")
    findings = [
        Finding(
            category="costs_money",
            severity="medium",
            title="Fee",
            detail="A fee.",
            quote="Check your add-ons before you continue.",
            section_id="s-2",
            nudge_phrase="There Is A Fee To Pay Here Right Now Before You Can Do Anything Else",
        ),
        Finding(
            category="costs_money",
            severity="high",
            title="Invented",
            detail="Made up.",
            quote="A secret fee of ₹9,999 applies.",
            section_id="s-2",
            nudge_phrase="x",
        ),
    ]
    risks = findings_to_risks(page, findings)
    assert len(risks) == 1
    assert risks[0].flag.quote == "Check your add-ons before you continue."
    # A phrase too long to speak whole falls back to the risk's title.
    assert risks[0].nudge_phrase == "fee"


def test_nudge_phrases_keep_acronyms() -> None:
    from app.services.scan import nudge_phrase

    assert nudge_phrase("More than one emi can be taken", "t") == "more than one EMI can be taken"
    assert nudge_phrase("the app reads your sms and contacts", "t") == (
        "the app reads your SMS and contacts"
    )
    assert nudge_phrase("NACH debits start on the 5th", "t") == "NACH debits start on the 5th"
    assert nudge_phrase("", "Mandate can't be cancelled") == "mandate can't be cancelled"
    assert nudge_phrase("QuickCred can debit 1.5 times your EMI", "t") == (
        "QuickCred can debit 1.5 times your EMI"
    )


def test_lower_first_keeps_names() -> None:
    from app.services.templates import lower_first

    assert lower_first("The fee applies") == "the fee applies"
    assert lower_first("QuickCred Shield renews") == "QuickCred Shield renews"
    assert lower_first("EMI debits") == "EMI debits"
    assert lower_first("₹1,299 add-on already ticked") == "₹1,299 add-on already ticked"
    assert lower_first("A") == "A"


def test_nudge_word_limit_falls_back_to_one_phrase() -> None:
    page = make_page("checkout")
    risks = merge_risks(client_flag_risks(page), [])
    long_phrase = "a very long phrase that goes on and on for many words here"
    risks[0].nudge_phrase = long_phrase
    risks[1].nudge_phrase = long_phrase
    nudge = build_nudge(page, risks, set())
    assert nudge is not None
    assert len(nudge.say.split()) < 25
    assert len(nudge.risk_ids) == 1
