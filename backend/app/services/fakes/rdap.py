"""Fake RDAP: 10 years old for listed brand domains, 3 days for anything else."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from app.services.lookalike import brand_domains


class FakeRdap:
    def __init__(self, now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> None:
        self.now = now

    async def registration_date(self, domain: str) -> datetime | None:
        if domain == "localhost" or domain.endswith(".localhost"):
            return None
        age = timedelta(days=3652) if domain in brand_domains() else timedelta(days=3)
        return self.now() - age
