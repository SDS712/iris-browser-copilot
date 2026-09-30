"""Builds every service once per app, choosing real or fake upstreams."""

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.services.assemblyai import AssemblyAIVoiceClient, VoiceClient, agents_http_client
from app.services.budget import SYNC_INTERVAL_SECONDS, Budget, Ledger, VoiceSessionSync
from app.services.fakes.assemblyai import FakeVoiceClient
from app.services.fakes.llm import FakeLLMClient
from app.services.fakes.rdap import FakeRdap
from app.services.fakes.search import FakeSearch
from app.services.llm import GatewayLLMClient, LLMClient, gateway_http_client
from app.services.pages import PageStore
from app.services.ratelimit import RateLimiter
from app.services.rdap import HttpRdapClient, RdapClient, rdap_http_client
from app.services.scan import ScanService
from app.services.search import SearchProvider, SearchService, TavilySearch, tavily_http_client
from app.services.ttl_cache import TTLCache
from app.settings import Settings

logger = logging.getLogger("iris.tasks")

SWEEP_INTERVAL_SECONDS = 60
DAY_SECONDS = 24 * 3600


@dataclass
class ToolCaches:
    """Per-app caches for tool results that cost money or credits to rebuild."""

    field_help: TTLCache[str, Any] = field(default_factory=lambda: TTLCache(DAY_SECONDS, 500))
    trust: TTLCache[str, Any] = field(default_factory=lambda: TTLCache(6 * 3600, 500))


@dataclass
class Services:
    settings: Settings
    ledger: Ledger
    budget: Budget
    voice: VoiceClient
    llm: LLMClient
    search: SearchService
    rdap: RdapClient
    pages: PageStore
    scans: ScanService
    voice_sync: VoiceSessionSync
    ratelimit: RateLimiter = field(default_factory=RateLimiter)
    caches: ToolCaches = field(default_factory=ToolCaches)
    http_clients: list[httpx.AsyncClient] = field(default_factory=list)
    tasks: list[asyncio.Task[None]] = field(default_factory=list)

    def start_background(self) -> None:
        self.tasks.append(asyncio.create_task(_every(SWEEP_INTERVAL_SECONDS, self._sweep)))
        self.tasks.append(
            asyncio.create_task(_every(SYNC_INTERVAL_SECONDS, self.voice_sync.sync, run_first=True))
        )

    async def _sweep(self) -> None:
        self.pages.sweep()
        self.ratelimit.sweep()

    async def close(self) -> None:
        for task in self.tasks:
            task.cancel()
        for task in self.tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await self.scans.close()
        for client in self.http_clients:
            await client.aclose()
        await self.ledger.close()


async def _every(
    seconds: float, job: Callable[[], Awaitable[object]], run_first: bool = False
) -> None:
    if not run_first:
        await asyncio.sleep(seconds)
    while True:
        try:
            await job()
        except Exception:
            logger.warning("background job failed", exc_info=True)
        await asyncio.sleep(seconds)


async def build_services(settings: Settings) -> Services:
    ledger = Ledger(settings.data_dir / "iris.db")
    await ledger.open()
    budget = Budget(ledger, settings)
    http_clients: list[httpx.AsyncClient] = []

    voice: VoiceClient
    llm: LLMClient
    search_provider: SearchProvider
    rdap: RdapClient
    if settings.iris_fake_upstreams:
        voice = FakeVoiceClient()
        llm = FakeLLMClient(budget)
        search_provider = FakeSearch()
        rdap = FakeRdap()
    else:
        agents_http = agents_http_client(settings.assemblyai_key())
        gateway_http = gateway_http_client(settings.assemblyai_key())
        tavily_http = tavily_http_client(settings.tavily_key())
        rdap_http = rdap_http_client()
        http_clients += [agents_http, gateway_http, tavily_http, rdap_http]
        voice = AssemblyAIVoiceClient(agents_http)
        llm = GatewayLLMClient(gateway_http, budget)
        search_provider = TavilySearch(tavily_http)
        rdap = HttpRdapClient(rdap_http)

    return Services(
        settings=settings,
        ledger=ledger,
        budget=budget,
        voice=voice,
        llm=llm,
        search=SearchService(search_provider, budget, settings),
        rdap=rdap,
        pages=PageStore(),
        scans=ScanService(llm, settings),
        voice_sync=VoiceSessionSync(voice, budget),
        http_clients=http_clients,
    )
