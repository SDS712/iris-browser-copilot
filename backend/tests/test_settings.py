"""Settings: secrets required outside fake mode, origins, and test mode forcing fakes."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.settings import Settings


def make(**values: object) -> Settings:
    return Settings(_env_file=None, **values)  # type: ignore[call-arg, arg-type]


def test_secrets_are_required_in_real_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("IRIS_ENV", raising=False)
    monkeypatch.delenv("IRIS_FAKE_UPSTREAMS", raising=False)
    monkeypatch.delenv("ASSEMBLYAI_API_KEY", raising=False)
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    with pytest.raises(ValidationError) as caught:
        make(iris_env="dev")
    assert "ASSEMBLYAI_API_KEY" in str(caught.value)
    assert "TAVILY_API_KEY" in str(caught.value)


def test_real_mode_with_keys() -> None:
    settings = make(
        iris_env="prod", iris_fake_upstreams=False, assemblyai_api_key="a", tavily_api_key="t"
    )
    assert settings.iris_fake_upstreams is False
    assert settings.assemblyai_key() == "a"
    assert settings.tavily_key() == "t"
    assert "a" not in repr(settings.assemblyai_api_key)


def test_test_mode_forces_fakes() -> None:
    settings = make(iris_env="test", iris_fake_upstreams=False)
    assert settings.iris_fake_upstreams is True
    assert settings.assemblyai_key() == ""


def test_allowed_origins_are_comma_separated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://iris.example.com, chrome-extension://abc ,")
    settings = make(iris_env="test")
    assert settings.allowed_origins == ["https://iris.example.com", "chrome-extension://abc"]


def test_defaults_match_the_contract() -> None:
    settings = make(iris_env="test")
    assert settings.budget_daily_usd == 15
    assert settings.budget_total_usd == 130
    assert settings.budget_tz == "Asia/Kolkata"
    assert str(settings.budget_start_date) == "2026-09-26"
    assert settings.voice_max_session_seconds == 600
    assert settings.max_concurrent_voice_sessions == 6
    assert settings.search_monthly_credit_limit == 900
    assert settings.llm_model_deep == "claude-sonnet-5"
    assert settings.llm_model_fast == "claude-haiku-4-5-20251001"
    assert settings.data_dir == Path("/data")
