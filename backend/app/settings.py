"""Backend settings, read from the environment (see .env.example)."""

from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    iris_env: Literal["dev", "test", "prod"] = "dev"
    iris_public_url: str = "http://localhost:8000"
    assemblyai_api_key: SecretStr | None = None
    tavily_api_key: SecretStr | None = None
    iris_voice_female: str = "eve"
    iris_voice_male: str = "alba"
    iris_speakable_say: bool = False
    llm_model_deep: str = "claude-sonnet-5"
    llm_model_fast: str = "claude-haiku-4-5-20251001"
    iris_fake_upstreams: bool = False
    budget_daily_usd: float = 15.0
    budget_total_usd: float = 130.0
    budget_tz: str = "Asia/Kolkata"
    budget_start_date: date = date(2026, 9, 26)
    voice_max_session_seconds: int = 600
    max_concurrent_voice_sessions: int = 6
    search_monthly_credit_limit: int = 900
    kill_switch: bool = False
    allowed_origins: Annotated[list[str], NoDecode] = []
    data_dir: Path = Path("/data")
    log_level: str = "INFO"

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def _check_mode(self) -> Self:
        # Tests must never reach a paid service, whatever the environment says.
        if self.iris_env == "test":
            self.iris_fake_upstreams = True
        if not self.iris_fake_upstreams:
            missing = [
                name
                for name, secret in (
                    ("ASSEMBLYAI_API_KEY", self.assemblyai_api_key),
                    ("TAVILY_API_KEY", self.tavily_api_key),
                )
                if secret is None or not secret.get_secret_value()
            ]
            if missing:
                raise ValueError(f"missing required settings: {', '.join(missing)}")
        return self

    def assemblyai_key(self) -> str:
        return self.assemblyai_api_key.get_secret_value() if self.assemblyai_api_key else ""

    def tavily_key(self) -> str:
        return self.tavily_api_key.get_secret_value() if self.tavily_api_key else ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
