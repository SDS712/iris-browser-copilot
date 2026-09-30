from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.deps import get_services, rate_limit
from app.schemas.api import AgentConfigResponse, VoiceTokenResponse
from app.services import voice_token
from app.services.agent_config import WARN_BEFORE_END_SECONDS, VoiceChoice, build_session
from app.services.container import Services

router = APIRouter()

ServicesDep = Annotated[Services, Depends(get_services)]


@router.get(
    "/agent-config",
    response_model=AgentConfigResponse,
    response_model_exclude_none=True,
)
async def agent_config(
    services: ServicesDep,
    greet: bool = Query(True),
    voice: Annotated[VoiceChoice, Query()] = "female",
) -> AgentConfigResponse:
    settings = services.settings
    return AgentConfigResponse(
        session=build_session(settings, greet, voice),
        max_session_seconds=settings.voice_max_session_seconds,
        warn_before_end_seconds=WARN_BEFORE_END_SECONDS,
    )


@router.get(
    "/voice-token",
    response_model=VoiceTokenResponse,
    dependencies=[Depends(rate_limit("voice_token"))],
)
async def get_voice_token(services: ServicesDep) -> VoiceTokenResponse:
    return await voice_token.mint(services)
