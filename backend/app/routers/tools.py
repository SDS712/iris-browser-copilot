from typing import Annotated

from fastapi import APIRouter, Depends

from app.deps import get_services, rate_limit
from app.schemas.api import (
    AskPageRequest,
    ExplainFieldRequest,
    LoanCostRequest,
    ScanRequest,
    SiteTrustRequest,
    SummarizeRequest,
    ToolResult,
    WalkthroughRequest,
    WalkthroughResponse,
    WebLookupRequest,
)
from app.services.container import Services
from app.services.tools import (
    ask_page,
    explain_field,
    loan_cost,
    scan_tool,
    site_trust,
    summarize,
    walkthrough,
    web_lookup,
)

router = APIRouter(prefix="/tools")

ServicesDep = Annotated[Services, Depends(get_services)]


@router.post(
    "/explain-field",
    response_model=ToolResult,
    dependencies=[Depends(rate_limit("tools"))],
)
async def explain_field_endpoint(body: ExplainFieldRequest, services: ServicesDep) -> ToolResult:
    return await explain_field.explain_field(services, body)


@router.post(
    "/ask-page",
    response_model=ToolResult,
    dependencies=[Depends(rate_limit("tools"))],
)
async def ask_page_endpoint(body: AskPageRequest, services: ServicesDep) -> ToolResult:
    return await ask_page.ask_page(services, body)


@router.post(
    "/summarize",
    response_model=ToolResult,
    dependencies=[Depends(rate_limit("tools"))],
)
async def summarize_endpoint(body: SummarizeRequest, services: ServicesDep) -> ToolResult:
    return await summarize.summarize(services, body)


@router.post(
    "/scan",
    response_model=ToolResult,
    dependencies=[Depends(rate_limit("tools"))],
)
async def scan_endpoint(body: ScanRequest, services: ServicesDep) -> ToolResult:
    return await scan_tool.scan(services, body)


@router.post(
    "/site-trust",
    response_model=ToolResult,
    dependencies=[Depends(rate_limit("site_trust"))],
)
async def site_trust_endpoint(body: SiteTrustRequest, services: ServicesDep) -> ToolResult:
    return await site_trust.site_trust(services, body)


@router.post(
    "/web-lookup",
    response_model=ToolResult,
    dependencies=[Depends(rate_limit("web_lookup"))],
)
async def web_lookup_endpoint(body: WebLookupRequest, services: ServicesDep) -> ToolResult:
    return await web_lookup.web_lookup(services, body)


@router.post(
    "/loan-cost",
    response_model=ToolResult,
    dependencies=[Depends(rate_limit("tools"))],
)
async def loan_cost_endpoint(body: LoanCostRequest, services: ServicesDep) -> ToolResult:
    return await loan_cost.loan_cost(services, body)


@router.post(
    "/walkthrough",
    response_model=WalkthroughResponse,
    dependencies=[Depends(rate_limit("tools"))],
)
async def walkthrough_endpoint(
    body: WalkthroughRequest, services: ServicesDep
) -> WalkthroughResponse:
    return await walkthrough.walkthrough(services, body)
