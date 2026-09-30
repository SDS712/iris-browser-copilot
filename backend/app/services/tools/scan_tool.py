"""scan: the full risk list, with a deterministic say line."""

from app.schemas.api import ScanRequest, ToolResult
from app.schemas.cards import RiskListCard
from app.services import templates
from app.services.container import Services
from app.services.scan import client_flag_risks, merge_risks, risk_targets
from app.services.tools.common import tool_result

WAIT_SECONDS = 20
MAX_HIGHLIGHTS = 5


async def scan(services: Services, request: ScanRequest) -> ToolResult:
    page = services.pages.get(request.page_id)
    state = page.scan
    if state is None or state.status == "none":
        state = await services.scans.run_now(page, request.kind or "general")
    elif state.status == "pending":
        await services.scans.wait(state, WAIT_SECONDS)

    if state.status == "ready":
        risks = [risk.flag for risk in state.risks]
    else:
        # Still pending after the wait, or failed: the client-rule risks stand on their own.
        risks = [risk.flag for risk in merge_risks(client_flag_risks(page), [])]
    high = [risk for risk in risks if risk.severity == "high"]
    card = RiskListCard(
        topic="Things to know", source="page", lead=templates.scan_lead(risks), risks=risks
    )
    return tool_result(
        services.settings,
        say=templates.scan_say(risks),
        card=card,
        agent_notes="; ".join(f"{risk.title}: {risk.detail}" for risk in risks),
        highlight_ids=risk_targets(high)[:MAX_HIGHLIGHTS],
    )
