"""explain_field: what a form field means, never what the user typed."""

import re

from rapidfuzz import fuzz, utils

from app.errors import ErrorCode, IrisError
from app.schemas.api import ExplainFieldRequest, ToolResult
from app.schemas.cards import FieldCard, FieldRow
from app.schemas.common import Source
from app.schemas.snapshot import PageField
from app.services.container import Services
from app.services.llm import FAST_TIMEOUT, LlmTask, build_messages
from app.services.llm_tasks import FieldHelp, FieldHelpFake
from app.services.pages import Page
from app.services.tools.common import tool_result, topic_words
from app.services.tools.web_lookup import numbered_results

MATCH_THRESHOLD = 80
# A looser match is used only when nothing better points at a field and it clearly wins.
LOOSE_THRESHOLD = 60
LOOSE_LEAD = 10
# A placeholder "shows a format" when it looks like an example value, not an instruction.
_FORMAT_RE = re.compile(r"\d|[A-Z]{2,}|\b(?:DD|MM|YYYY)\b|@")
_INSTRUCTION_RE = re.compile(r"^\s*(enter|type|your|select|choose)\b", re.IGNORECASE)


def label_scores(fields: list[PageField], field_label: str) -> list[tuple[float, PageField]]:
    """Best match first. Ties go to the closer whole label: "PAN" is the PAN field, not
    "Full name (as on PAN)", which scores the same as a token subset."""
    scored = [
        (
            fuzz.token_set_ratio(field_label, field.label, processor=utils.default_process),
            fuzz.ratio(field_label, field.label, processor=utils.default_process),
            field,
        )
        for field in fields
    ]
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [(score, field) for score, _, field in scored]


def find_field(
    page: Page, field_id: str | None, field_label: str | None, pointer_id: str | None = None
) -> PageField:
    """The field the user means: its ID, a clear match for its name, the field they point at,
    then a looser match for the name that clearly beats the rest. Otherwise ask."""
    fields = page.snapshot.fields
    by_id = {field.id: field for field in fields}
    if field_id and field_id in by_id:
        return by_id[field_id]
    scored = label_scores(fields, field_label) if field_label else []
    if scored and scored[0][0] >= MATCH_THRESHOLD:
        return scored[0][1]
    if pointer_id and pointer_id in by_id:
        return by_id[pointer_id]
    if scored and scored[0][0] >= LOOSE_THRESHOLD:
        runner_up = scored[1][0] if len(scored) > 1 else 0.0
        if scored[0][0] - runner_up >= LOOSE_LEAD:
            return scored[0][1]
    candidates = [field.label for _, field in scored[:3]] or [field.label for field in fields[:3]]
    examples = f" For example: {', '.join(candidates)}." if candidates else ""
    lead = (
        f"I couldn't find a field called '{field_label}' on this page."
        if field_label
        else "I couldn't tell which field the user means."
    )
    raise IrisError(
        ErrorCode.INVALID_REQUEST,
        "I couldn't find that field on this page.",
        agent_message=f"{lead} Ask the user which field they mean.{examples}",
    )


def shows_format(field: PageField) -> bool:
    placeholder = field.placeholder
    return bool(
        placeholder
        and not field.sensitive
        and _FORMAT_RE.search(placeholder)
        and not _INSTRUCTION_RE.match(placeholder)
    )


def page_explains(field: PageField) -> bool:
    return bool(field.help_text) or shows_format(field)


def field_context(page: Page, field: PageField) -> str:
    fields = page.snapshot.fields
    position = fields.index(field)
    neighbours = [f.label for f in fields[max(0, position - 2) : position + 3] if f is not field]
    section_text = next(
        (s.text[:1500] for s in page.sections if field.section and s.heading == field.section), ""
    )
    lines = [
        page.header(),
        "",
        f"FIELD: {field.label}",
        f"TYPE: {field.type}",
        f"REQUIRED: {'yes' if field.required else 'no'}",
        f"SECTION: {field.section or '(none)'}",
        f"HELP TEXT: {field.help_text or '(none)'}",
        f"PLACEHOLDER: {field.placeholder if shows_format(field) else '(none)'}",
        f"OPTIONS: {'; '.join(field.options) or '(none)'}",
        f"NEIGHBOURING FIELDS: {'; '.join(neighbours) or '(none)'}",
    ]
    if section_text:
        lines += ["", f"SECTION TEXT: {section_text}"]
    return "\n".join(lines)


def label_key(label: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", label.lower()).split())


def field_card(field: PageField, help_: FieldHelp, source: str) -> FieldCard:
    rows = [FieldRow(label=row.label, value=row.value) for row in help_.rows]
    return FieldCard(
        topic=topic_words(field.label, "Form field"),
        source="web" if source == "web" else "page",
        lead=help_.lead,
        field_id=field.id,
        rows=rows,
        example=help_.example,
    )


async def explain_from_page(services: Services, page: Page, field: PageField) -> FieldHelp:
    task = LlmTask(
        name="field_help",
        output=FieldHelp,
        model=services.settings.llm_model_fast,
        purpose="explain_field",
        messages=build_messages("explain_field", field_context(page, field)),
        max_tokens=600,
        timeout=FAST_TIMEOUT,
        fake_input=FieldHelpFake(
            label=field.label,
            help_text=field.help_text,
            placeholder=field.placeholder if shows_format(field) else None,
            from_web=False,
        ),
    )
    return await services.llm.complete(task)


async def explain_from_web(
    services: Services, page: Page, field: PageField
) -> tuple[FieldHelp, list[Source]]:
    """Search results explain the field; cached by label for 24 hours, across pages."""
    key = label_key(field.label)
    cached = services.caches.field_help.get(key)
    if cached is not None:
        help_cached: tuple[FieldHelp, list[Source]] = cached
        return help_cached
    hits = (await services.search.search(f'"{field.label} meaning" India form'))[:3]
    context = field_context(page, field)
    if hits:
        context += f"\n\nSEARCH RESULTS:\n{numbered_results(hits)}"
    task = LlmTask(
        name="field_help",
        output=FieldHelp,
        model=services.settings.llm_model_fast,
        purpose="explain_field",
        messages=build_messages("explain_field", context),
        max_tokens=600,
        timeout=FAST_TIMEOUT,
        fake_input=FieldHelpFake(
            label=field.label, help_text=None, placeholder=None, from_web=True
        ),
    )
    entry = (await services.llm.complete(task), [hit.source() for hit in hits])
    services.caches.field_help.set(key, entry)
    return entry


async def explain_field(services: Services, request: ExplainFieldRequest) -> ToolResult:
    page = services.pages.get(request.page_id)
    pointer_id = request.pointer.field_id if request.pointer else None
    field = find_field(page, request.field_id, request.field_label, pointer_id)
    source = "page"
    sources: list[Source] = []
    if page_explains(field):
        help_ = await explain_from_page(services, page, field)
    else:
        try:
            help_, sources = await explain_from_web(services, page, field)
            source = "web"
        except IrisError as exc:
            # Search is down or out of credits: explain from what the page shows instead.
            if exc.code not in (ErrorCode.UPSTREAM_ERROR, ErrorCode.UPSTREAM_TIMEOUT):
                raise
            help_ = await explain_from_page(services, page, field)
    return tool_result(
        services.settings,
        say=help_.say,
        card=field_card(field, help_, source),
        agent_notes=help_.agent_notes,
        highlight_ids=[field.id],
        sources=sources,
    )
