from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.deps import get_services, rate_limit
from app.schemas.api import CreatePageRequest, CreatePageResponse, ScanResult
from app.services import page_intake
from app.services.container import Services

router = APIRouter()

ServicesDep = Annotated[Services, Depends(get_services)]


async def raw_snapshot_rules(request: Request) -> None:
    # Runs on the raw bytes, before the body is validated into models.
    page_intake.check_raw_snapshot(await request.body())


@router.post(
    "/pages",
    response_model=CreatePageResponse,
    dependencies=[Depends(rate_limit("pages")), Depends(raw_snapshot_rules)],
)
async def create_page(payload: CreatePageRequest, services: ServicesDep) -> CreatePageResponse:
    return await page_intake.register(services, payload.snapshot)


@router.get("/pages/{page_id}/scan", response_model=ScanResult)
async def get_scan(
    page_id: str,
    services: ServicesDep,
    exclude_keys: Annotated[str | None, Query(max_length=4000)] = None,
) -> ScanResult:
    page = services.pages.get(page_id)
    excluded = {key.strip() for key in (exclude_keys or "").split(",") if key.strip()}
    return services.scans.result(page, excluded)
