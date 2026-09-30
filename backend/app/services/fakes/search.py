"""Fake search: two fixed results per query, on example.org."""

import re

from app.services.search import SearchHit, SearchTopic


class FakeSearch:
    async def search(self, query: str, *, max_results: int, topic: SearchTopic) -> list[SearchHit]:
        slug = re.sub(r"[^a-z0-9]+", "-", query.lower()).strip("-") or "query"
        return [
            SearchHit(
                title=f"What {query} means",
                url=f"https://example.org/guide/{slug}",
                content=f"{query} is explained here in plain words. This guide covers what it "
                "means and where people usually come across it.",
                score=0.9,
            ),
            SearchHit(
                title=f"{query}: questions and answers",
                url=f"https://example.org/faq/{slug}",
                content=f"Common questions about {query}, with short answers.",
                score=0.7,
            ),
        ][:max_results]
