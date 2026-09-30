"""Web search: a provider interface, Tavily, credit counting and a 24-hour cache."""

import re
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from urllib.parse import urlsplit

import httpx

from app.errors import ErrorCode, IrisError
from app.schemas.common import Source
from app.services.budget import Budget
from app.services.ttl_cache import TTLCache
from app.services.upstream import request_json, upstream_failure
from app.settings import Settings

TAVILY_URL = "https://api.tavily.com/search"
CACHE_SECONDS = 24 * 3600
CACHE_SIZE = 500
UNAVAILABLE_AGENT_MESSAGE = (
    "Web search is unavailable right now. Tell the user you can't look that up at the moment."
)

SearchTopic = Literal["general", "news"]


@dataclass(frozen=True)
class SearchHit:
    title: str
    url: str
    content: str
    score: float

    @property
    def domain(self) -> str:
        host = urlsplit(self.url).hostname or ""
        return host.removeprefix("www.")

    def source(self) -> Source:
        return Source(title=self.title, url=self.url, domain=self.domain)


class SearchProvider(Protocol):
    async def search(
        self, query: str, *, max_results: int, topic: SearchTopic
    ) -> list[SearchHit]: ...


def tavily_http_client(api_key: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(headers={"Authorization": f"Bearer {api_key}"}, timeout=10.0)


def parse_tavily(body: Any) -> list[SearchHit]:
    if not isinstance(body, dict) or not isinstance(body.get("results"), list):
        raise upstream_failure("tavily")
    hits = []
    for item in body["results"]:
        url = item.get("url")
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            continue
        hits.append(
            SearchHit(
                title=str(item.get("title") or url),
                url=url,
                content=str(item.get("content") or ""),
                score=float(item.get("score") or 0.0),
            )
        )
    return hits


class TavilySearch:
    def __init__(self, http: httpx.AsyncClient) -> None:
        self.http = http

    async def search(self, query: str, *, max_results: int, topic: SearchTopic) -> list[SearchHit]:
        body = await request_json(
            self.http,
            "POST",
            TAVILY_URL,
            upstream="tavily",
            json={
                "query": query,
                "search_depth": "basic",
                "topic": topic,
                "max_results": max_results,
                "include_answer": False,
                "include_raw_content": False,
            },
        )
        return parse_tavily(body)


def normalise_query(query: str) -> str:
    return re.sub(r"\s+", " ", query.strip().lower())


class SearchService:
    """Caps, the monthly credit limit and the cache sit in front of any provider."""

    def __init__(self, provider: SearchProvider, budget: Budget, settings: Settings) -> None:
        self.provider = provider
        self.budget = budget
        self.settings = settings
        self._cache: TTLCache[tuple[str, int, str], list[SearchHit]] = TTLCache(
            CACHE_SECONDS, CACHE_SIZE
        )

    async def search(
        self, query: str, *, max_results: int = 5, topic: SearchTopic = "general"
    ) -> list[SearchHit]:
        key = (normalise_query(query), max_results, topic)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        await self.budget.check()
        if (
            await self.budget.search_credits_this_month()
            >= self.settings.search_monthly_credit_limit
        ):
            raise IrisError(ErrorCode.UPSTREAM_ERROR, agent_message=UNAVAILABLE_AGENT_MESSAGE)
        # A basic search costs one credit, whether or not it succeeds.
        await self.budget.record_search(1)
        try:
            hits = await self.provider.search(query, max_results=max_results, topic=topic)
        except IrisError as exc:
            raise IrisError(exc.code, agent_message=UNAVAILABLE_AGENT_MESSAGE) from exc
        self._cache.set(key, hits)
        return hits
