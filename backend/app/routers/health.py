from typing import Annotated

from fastapi import APIRouter, Depends

from app.deps import get_services
from app.schemas.api import HealthResponse, ServiceState
from app.services.container import Services

router = APIRouter()

VERSION = "1.0.0"


@router.get("/health", response_model=HealthResponse)
async def health(services: Annotated[Services, Depends(get_services)]) -> HealthResponse:
    status = await services.budget.status()
    return HealthResponse(
        version=VERSION, service=ServiceState(open=status.open, reason=status.reason)
    )
