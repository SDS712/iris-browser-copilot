"""The guided walkthrough's explanations, a few steps at a time: page sections
 or the parts and fields of a form. No field value is ever here:
snapshots only say whether a field is filled."""

import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.schemas.api import FormStep, WalkthroughRequest, WalkthroughResponse, WalkthroughStep
from app.schemas.snapshot import Choice, PageField
from app.services.container import Services
from app.services.llm import FAST_TIMEOUT, LlmTask, build_messages
from app.services.llm_tasks import WalkthroughFake, WalkthroughLines
from app.services.pages import Page, PreparedSection
from app.services.say import finalise
from app.services.tools.explain_field import shows_format

SECTION_CHARS = 2_500
MAX_WORDS = 30
FORM_MAX_WORDS = 35
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


def clip_words(text: str, limit: int = MAX_WORDS) -> str:
    words = text.split()
    return text if len(words) <= limit else " ".join(words[:limit]).rstrip(",;:") + "…"


def fallback_say(section: PreparedSection) -> str:
    """The section's first sentence, when the model gives nothing for it."""
    first = _SENTENCE_RE.split(section.text.strip(), maxsplit=1)[0]
    return clip_words(first)


def walkthrough_context(page: Page, sections: list[PreparedSection]) -> str:
    risks = page.scan.risks if page.scan and page.scan.status == "ready" else []
    ids = {section.id for section in sections}
    known = "\n".join(
        f"[{risk.flag.section_id}] {risk.flag.title}"
        for risk in risks
        if risk.flag.section_id in ids
    )
    body = "\n\n".join(
        f"{section.labelled().splitlines()[0]}\n{section.text[:SECTION_CHARS]}"
        for section in sections
    )
    return f"{page.header()}\n\nSECTIONS:\n{body}\n\nKNOWN RISKS:\n{known or '(none)'}"


# --- Forms ---


@dataclass(frozen=True)
class FormPart:
    """A form step with its elements found on the page (unknown IDs dropped)."""

    step: FormStep
    fields: list[PageField]
    choices: list[Choice]

    @property
    def ids(self) -> set[str]:
        return {f.id for f in self.fields} | {c.id for c in self.choices}


def field_line(field: PageField) -> str:
    notes = [field.type, "required" if field.required else "optional"]
    if field.sensitive:
        notes.append("sensitive: never to be said aloud")
    notes.append("already filled" if field.filled else "empty")
    if field.help_text:
        notes.append(f"help: {field.help_text}")
    if shows_format(field):
        notes.append(f"format shown: {field.placeholder}")
    if field.options:
        notes.append(f"options: {'; '.join(field.options[:8])}")
    return f'- Field "{field.label}" ({", ".join(notes)})'


def choice_lines(choices: Sequence[Choice]) -> list[str]:
    lines: list[str] = []
    radios: dict[str, list[Choice]] = {}
    for choice in choices:
        if choice.kind == "radio":
            radios.setdefault(choice.group or choice.label, []).append(choice)
            continue
        state = (
            "ticked by the site before the person touched it"
            if choice.prechecked
            else "ticked"
            if choice.checked
            else "not ticked"
        )
        lines.append(f'- Checkbox "{choice.label}" ({state})')
    for group, options in radios.items():
        picked = next((o.label for o in options if o.checked), None)
        labels = "; ".join(o.label for o in options)
        state = f"picked: {picked}" if picked else "none picked"
        lines.append(f'- Choice "{group}" (options: {labels}; {state})')
    return lines


def form_parts(page: Page, steps: list[FormStep]) -> list[FormPart]:
    fields = {f.id: f for f in page.snapshot.fields}
    choices = {c.id: c for c in page.snapshot.checkboxes}
    parts = []
    for step in steps:
        part = FormPart(
            step=step,
            fields=[fields[i] for i in step.element_ids if i in fields],
            choices=[choices[i] for i in step.element_ids if i in choices],
        )
        if part.fields or part.choices:
            parts.append(part)
    return parts


def form_fallback(part: FormPart) -> str:
    """ "This part asks for your A, B and C." when the model gives nothing."""
    labels = [f.label for f in part.fields] + [c.group or c.label for c in part.choices]
    names = list(dict.fromkeys(labels))
    listed = names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"
    return clip_words(f"This part asks for your {listed}.", FORM_MAX_WORDS)


def form_context(page: Page, parts: list[FormPart]) -> str:
    risks = page.scan.risks if page.scan and page.scan.status == "ready" else []
    blocks = []
    known = []
    for part in parts:
        lines = [field_line(f) for f in part.fields] + choice_lines(part.choices)
        heading = f" {part.step.heading}" if part.step.heading else ""
        blocks.append(f"[{part.step.key}]{heading}\n" + "\n".join(lines))
        known += [
            f"[{part.step.key}] {r.flag.title}" for r in risks if part.ids & set(r.flag.element_ids)
        ]
    return (
        f"{page.header()}\n\nSTEPS:\n"
        + "\n\n".join(blocks)
        + f"\n\nKNOWN RISKS:\n{chr(10).join(known) or '(none)'}"
    )


async def walk_form(services: Services, page: Page, steps: list[FormStep]) -> WalkthroughResponse:
    parts = form_parts(page, steps)
    if not parts:
        return WalkthroughResponse(steps=[])
    task = LlmTask(
        name="walkthrough_steps",
        output=WalkthroughLines,
        model=services.settings.llm_model_fast,
        purpose="walkthrough",
        messages=build_messages("walkthrough_form", form_context(page, parts)),
        max_tokens=160 * len(parts),
        timeout=FAST_TIMEOUT,
        fake_input=WalkthroughFake(steps=[(p.step.key, form_fallback(p)) for p in parts]),
    )
    said = {line.key: line.say.strip() for line in (await services.llm.complete(task)).steps}
    risks = page.scan.risks if page.scan and page.scan.status == "ready" else []
    return WalkthroughResponse(
        steps=[
            WalkthroughStep(
                key=part.step.key,
                heading=part.step.heading,
                say=finalise(
                    clip_words(said.get(part.step.key) or "", FORM_MAX_WORDS)
                    or form_fallback(part),
                    speakable_say=services.settings.iris_speakable_say,
                ),
                risk_ids=[r.flag.id for r in risks if part.ids & set(r.flag.element_ids)],
            )
            for part in parts
        ]
    )


async def walk_sections(
    services: Services, page: Page, section_ids: list[str]
) -> WalkthroughResponse:
    sections = [
        page.section_by_id[section_id]
        for section_id in dict.fromkeys(section_ids)
        if section_id in page.section_by_id
    ]
    if not sections:
        return WalkthroughResponse(steps=[])
    task = LlmTask(
        name="walkthrough_steps",
        output=WalkthroughLines,
        model=services.settings.llm_model_fast,
        purpose="walkthrough",
        messages=build_messages("walkthrough", walkthrough_context(page, sections)),
        max_tokens=150 * len(sections),
        timeout=FAST_TIMEOUT,
        fake_input=WalkthroughFake(steps=[(s.id, s.text) for s in sections]),
    )
    said = {line.key: line.say.strip() for line in (await services.llm.complete(task)).steps}
    risks = page.scan.risks if page.scan and page.scan.status == "ready" else []
    return WalkthroughResponse(
        steps=[
            WalkthroughStep(
                key=section.id,
                heading=section.heading,
                say=finalise(
                    clip_words(said.get(section.id) or "") or fallback_say(section),
                    speakable_say=services.settings.iris_speakable_say,
                ),
                risk_ids=[r.flag.id for r in risks if r.flag.section_id == section.id],
            )
            for section in sections
        ]
    )


async def walkthrough(services: Services, request: WalkthroughRequest) -> WalkthroughResponse:
    page = services.pages.get(request.page_id)
    if request.form_steps:
        return await walk_form(services, page, request.form_steps)
    return await walk_sections(services, page, request.section_ids)
