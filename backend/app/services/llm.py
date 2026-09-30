"""LLM Gateway client: structured output, prompt caching, retries and cost."""

import asyncio
import json
import logging
import random
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from app.errors import ErrorCode, IrisError
from app.pricing import ModelPrice, llm_cost_usd, model_price
from app.services.budget import Budget
from app.services.upstream import upstream_failure, upstream_timeout

logger = logging.getLogger("iris.llm")

GATEWAY_BASE_URL = "https://llm-gateway.assemblyai.com"
FAST_TIMEOUT = 12.0
DEEP_TIMEOUT = 25.0
CACHE_CONTROL = {"type": "ephemeral", "ttl": "5m"}
PROMPTS_DIR = Path(__file__).resolve().parents[1] / "prompts"

# Models the Gateway serves without `response_format` or `temperature` (checked against the
# live Gateway on 2026-09-26). For these the schema goes into the system prompt instead,
# and json-repair tidies the reply.
SCHEMA_IN_PROMPT_MODELS = frozenset({"claude-sonnet-5"})
_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL)

# Keywords Claude's strict structured outputs don't accept.
_UNSUPPORTED_KEYWORDS = frozenset(
    {
        "title",
        "default",
        "maxLength",
        "minLength",
        "maxItems",
        "minItems",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "pattern",
        "examples",
    }
)


@dataclass(frozen=True)
class LlmTask[T: BaseModel]:
    name: str  # the schema name sent to the Gateway, e.g. "ask_page_answer"
    output: type[T]
    model: str
    purpose: str  # recorded in the ledger
    messages: list[dict[str, Any]]
    max_tokens: int
    timeout: float
    fake_input: object = None


class LLMClient(Protocol):
    async def complete[T: BaseModel](self, task: LlmTask[T]) -> T: ...


@cache
def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8").strip()


def build_messages(prompt: str, context: str, request: str | None = None) -> list[dict[str, Any]]:
    """System prompt, then the page context marked as a cache breakpoint, then the request.

    Follow-up questions on the same page share the prefix up to the breakpoint.
    """
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": load_prompt(prompt)},
        {"role": "user", "content": context, "cache_control": CACHE_CONTROL},
    ]
    if request:
        messages.append({"role": "user", "content": request})
    return messages


def strict_schema(model: type[BaseModel]) -> dict[str, Any]:
    """The model's JSON schema adjusted for strict mode: every property required, no extras."""

    def fix(node: Any) -> Any:
        if isinstance(node, list):
            return [fix(item) for item in node]
        if not isinstance(node, dict):
            return node
        fixed: dict[str, Any] = {}
        for key, value in node.items():
            if key in _UNSUPPORTED_KEYWORDS:
                continue
            if key in ("properties", "$defs"):
                # Keys here are field or model names, never keywords.
                fixed[key] = {name: fix(sub) for name, sub in value.items()}
            else:
                fixed[key] = fix(value)
        if fixed.get("type") == "object" and "properties" in fixed:
            fixed["required"] = list(fixed["properties"])
            fixed["additionalProperties"] = False
        return fixed

    result: dict[str, Any] = fix(model.model_json_schema())
    return result


def estimate_cost(price: ModelPrice, messages: list[dict[str, Any]], max_tokens: int) -> float:
    input_chars = sum(len(str(message.get("content", ""))) for message in messages)
    return llm_cost_usd(price, input_chars // 4 + 1, max_tokens)


def price_or_refuse(model: str) -> ModelPrice:
    price = model_price(model)
    if price is None:
        # Fail closed: a model without a price could spend without limit.
        logger.error("no price for model; refusing the call", extra={"iris": {"model": model}})
        raise IrisError(ErrorCode.UPSTREAM_ERROR)
    return price


def parse_output[T: BaseModel](output: type[T], content: str) -> T:
    fenced = _FENCE_RE.match(content)
    return output.model_validate(json.loads(fenced.group(1) if fenced else content))


def with_schema_instruction(
    messages: list[dict[str, Any]], name: str, schema: dict[str, Any]
) -> list[dict[str, Any]]:
    """Adds the output schema to the system message, for models without structured output."""
    instruction = (
        f'\n\nReply with only a JSON object that matches the JSON schema "{name}" below, '
        f"with no other text:\n{json.dumps(schema, separators=(',', ':'))}"
    )
    result = [dict(message) for message in messages]
    if result and result[0].get("role") == "system":
        result[0]["content"] = str(result[0]["content"]) + instruction
    else:
        result.insert(0, {"role": "system", "content": instruction.strip()})
    return result


def _message_text(data: Any) -> str:
    content = data["choices"][0]["message"]["content"]
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict))
    if not isinstance(content, str):
        raise TypeError("no text content")
    return content


def gateway_http_client(api_key: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=GATEWAY_BASE_URL,
        headers={"authorization": api_key, "content-type": "application/json"},
    )


class GatewayLLMClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        budget: Budget,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.http = http
        self.budget = budget
        self.sleep = sleep

    async def complete[T: BaseModel](self, task: LlmTask[T]) -> T:
        messages = list(task.messages)
        content = await self._call(task, messages)
        try:
            return parse_output(task.output, content)
        except (ValueError, ValidationError) as exc:
            error = str(exc)[:500]
        # One more try with the validation error, as the model can usually fix it.
        messages += [
            {"role": "assistant", "content": content},
            {
                "role": "user",
                "content": f"That reply didn't match the schema: {error}\n"
                "Reply again with only JSON that matches the schema.",
            },
        ]
        content = await self._call(task, messages)
        try:
            return parse_output(task.output, content)
        except (ValueError, ValidationError) as exc:
            raise upstream_failure("llm_gateway") from exc

    def _body(self, task: LlmTask[Any], messages: list[dict[str, Any]]) -> dict[str, Any]:
        schema = strict_schema(task.output)
        body: dict[str, Any] = {
            "model": task.model,
            "messages": messages,
            "max_tokens": task.max_tokens,
            "model_region": "global",
            "post_processing_steps": [{"type": "json-repair"}],
        }
        if task.model in SCHEMA_IN_PROMPT_MODELS:
            body["messages"] = with_schema_instruction(messages, task.name, schema)
        else:
            body["temperature"] = 0.2
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": task.name, "schema": schema, "strict": True},
            }
        return body

    async def _call(self, task: LlmTask[Any], messages: list[dict[str, Any]]) -> str:
        price = price_or_refuse(task.model)
        body = self._body(task, messages)
        estimate = estimate_cost(price, body["messages"], task.max_tokens)
        for attempt in (1, 2):
            await self.budget.check(estimate)
            retry = attempt == 1
            try:
                response = await self.http.post(
                    "/v1/chat/completions", json=body, timeout=task.timeout
                )
            except httpx.TimeoutException as exc:
                if retry:
                    await self._backoff()
                    continue
                raise upstream_timeout("llm_gateway") from exc
            except httpx.HTTPError as exc:
                if retry:
                    await self._backoff()
                    continue
                raise upstream_failure("llm_gateway") from exc
            if response.status_code == 429 or response.status_code >= 500:
                if retry:
                    await self._backoff()
                    continue
                raise upstream_failure("llm_gateway", response.status_code)
            if response.status_code >= 400:
                raise upstream_failure("llm_gateway", response.status_code)
            try:
                data = response.json()
            except ValueError as exc:
                await self._record(task, price, {}, estimate)
                raise upstream_failure("llm_gateway", response.status_code) from exc
            await self._record(task, price, data, estimate)
            try:
                return _message_text(data)
            except (KeyError, IndexError, TypeError) as exc:
                raise upstream_failure("llm_gateway", response.status_code) from exc
        raise upstream_failure(
            "llm_gateway"
        )  # pragma: no cover - the loop always returns or raises

    async def _backoff(self) -> None:
        await self.sleep(random.uniform(0.5, 1.5))  # noqa: S311 - jitter, not security

    async def _record(
        self, task: LlmTask[Any], price: ModelPrice, data: Any, estimate: float
    ) -> None:
        usage = data.get("usage") if isinstance(data, dict) else None
        usage = usage if isinstance(usage, dict) else {}
        completion_tokens = int(usage.get("completion_tokens") or 0)
        details = usage.get("prompt_tokens_details")
        details = details if isinstance(details, dict) else {}
        creation = details.get("cache_creation")
        creation = creation if isinstance(creation, dict) else {}
        cached_tokens = int(details.get("cached_tokens") or 0)
        write_5m = int(creation.get("ephemeral_5m_input_tokens") or 0)
        write_1h = int(creation.get("ephemeral_1h_input_tokens") or 0)
        # For Claude, the Gateway's prompt_tokens leaves out cache reads and cache writes,
        # so the full input is the sum of all three (checked on 2026-09-26). If a model's
        # prompt_tokens already includes cache reads, this over-counts, never under-counts.
        prompt_tokens = int(usage.get("prompt_tokens") or 0) + cached_tokens + write_5m + write_1h
        if prompt_tokens or completion_tokens:
            cost = llm_cost_usd(
                price,
                prompt_tokens - write_5m - write_1h,
                completion_tokens,
                cache_write_5m=write_5m,
                cache_write_1h=write_1h,
            )
        else:
            # No usage reported: count the estimate so the ledger never under-counts.
            cost = estimate
        await self.budget.record_llm_call(
            task.model, task.purpose, prompt_tokens, cached_tokens, completion_tokens, cost
        )
        logger.info(
            "llm call",
            extra={
                "iris": {
                    "model": task.model,
                    "purpose": task.purpose,
                    "prompt_tokens": prompt_tokens,
                    "cached_tokens": cached_tokens,
                    "completion_tokens": completion_tokens,
                    "cost_usd": round(cost, 6),
                }
            },
        )
