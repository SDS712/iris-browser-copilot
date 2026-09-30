from typing import Annotated

from fastapi import APIRouter, Depends

from app.deps import get_services, rate_limit
from app.schemas.api import JourneySummaryRequest, JourneySummaryResponse
from app.services import journey
from app.services.container import Services

router = APIRouter()

ServicesDep = Annotated[Services, Depends(get_services)]


@router.post(
    "/journey/summary",
    response_model=JourneySummaryResponse,
    dependencies=[Depends(rate_limit("tools"))],
)
async def journey_summary(
    body: JourneySummaryRequest, services: ServicesDep
) -> JourneySummaryResponse:
    return await journey.summarise(services, body)
