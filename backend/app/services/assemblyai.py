"""AssemblyAI Voice Agent API: single-use tokens and the sessions list."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.services.upstream import request_json, upstream_failure

AGENTS_BASE_URL = "https://agents.assemblyai.com"
TOKEN_EXPIRES_IN_SECONDS = 300


@dataclass(frozen=True)
class VoiceSessionInfo:
    id: str
    created_at: datetime
    ended_at: datetime | None
    duration_seconds: float | None


@dataclass(frozen=True)
class SessionsPage:
    sessions: list[VoiceSessionInfo]
    next_cursor: str | None


class VoiceClient(Protocol):
    async def mint_token(self, max_session_seconds: int) -> str: ...

    async def list_sessions(self, cursor: str | None) -> SessionsPage: ...


def agents_http_client(api_key: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=AGENTS_BASE_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=8.0,
    )


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    return datetime.fromisoformat(value)


def parse_sessions_page(body: Any) -> SessionsPage:
    if not isinstance(body, dict) or not isinstance(body.get("sessions"), list):
        raise upstream_failure("assemblyai_sessions")
    sessions = []
    for item in body["sessions"]:
        created_at = _parse_time(item.get("created_at"))
        if not item.get("id") or created_at is None:
            continue
        duration = item.get("duration_seconds")
        sessions.append(
            VoiceSessionInfo(
                id=str(item["id"]),
                created_at=created_at,
                ended_at=_parse_time(item.get("ended_at")),
                duration_seconds=float(duration) if isinstance(duration, int | float) else None,
            )
        )
    metadata = body.get("response_metadata") or {}
    cursor = metadata.get("next_cursor") if body.get("has_more") else None
    return SessionsPage(sessions=sessions, next_cursor=cursor or None)


class AssemblyAIVoiceClient:
    def __init__(self, http: httpx.AsyncClient) -> None:
        self.http = http

    async def mint_token(self, max_session_seconds: int) -> str:
        body = await request_json(
            self.http,
            "GET",
            "/v1/token",
            upstream="assemblyai_token",
            params={
                "expires_in_seconds": TOKEN_EXPIRES_IN_SECONDS,
                "max_session_duration_seconds": max_session_seconds,
            },
        )
        token = body.get("token") if isinstance(body, dict) else None
        if not isinstance(token, str) or not token:
            raise upstream_failure("assemblyai_token")
        return token

    async def list_sessions(self, cursor: str | None) -> SessionsPage:
        params: dict[str, str | int] = {"limit": 200}
        if cursor:
            params["cursor"] = cursor
        body = await request_json(
            self.http, "GET", "/v1/sessions", upstream="assemblyai_sessions", params=params
        )
        return parse_sessions_page(body)
