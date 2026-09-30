"""Minting single-use voice tokens."""

from app.errors import ErrorCode, IrisError
from app.schemas.api import VoiceTokenResponse
from app.services.assemblyai import TOKEN_EXPIRES_IN_SECONDS
from app.services.container import Services

BUSY_MESSAGE = "Iris is busy right now. Please try again in a few minutes."
BUSY_RETRY_SECONDS = 120


async def mint(services: Services) -> VoiceTokenResponse:
    """Caps (after a fresh usage sync), then the concurrency limit, then a single-use token."""
    settings = services.settings
    await services.voice_sync.sync_if_stale()
    await services.budget.check()
    if await services.budget.voice_sessions_in_flight() >= settings.max_concurrent_voice_sessions:
        raise IrisError(
            ErrorCode.RATE_LIMITED,
            BUSY_MESSAGE,
            agent_message="Iris is busy with other people right now. "
            "Tell the user to try again in a few minutes.",
            retry_after_seconds=BUSY_RETRY_SECONDS,
        )
    token = await services.voice.mint_token(settings.voice_max_session_seconds)
    await services.budget.reserve_voice()
    return VoiceTokenResponse(
        token=token,
        expires_in_seconds=TOKEN_EXPIRES_IN_SECONDS,
        max_session_seconds=settings.voice_max_session_seconds,
    )
