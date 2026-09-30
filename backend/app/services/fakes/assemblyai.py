"""Fake Voice Agent API: a fixed token and no sessions."""

from app.services.assemblyai import SessionsPage


class FakeVoiceClient:
    async def mint_token(self, max_session_seconds: int) -> str:
        return "fake-token"

    async def list_sessions(self, cursor: str | None) -> SessionsPage:
        return SessionsPage(sessions=[], next_cursor=None)
