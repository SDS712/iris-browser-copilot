"""LLM Gateway client: request shape, retries, parsing, cost recording and the caps."""

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx

from app.errors import IrisError
from app.services.budget import Budget, Ledger
from app.services.llm import (
    GATEWAY_BASE_URL,
    GatewayLLMClient,
    LlmTask,
    build_messages,
    gateway_http_client,
    strict_schema,
)
from app.services.llm_tasks import AskPageAnswer, ScanFindings
from app.settings import Settings

URL = f"{GATEWAY_BASE_URL}/v1/chat/completions"
ANSWER = {
    "answer_type": "from_page",
    "say": "Yes, with 30 days' notice.",
    "lead": "You can cancel with 30 days' notice.",
    "topic": "Cancellation",
    "quote": {"section_id": "s-19", "text": "30 days' written notice"},
    "related_risk_ids": [],
    "agent_notes": "",
    "question_kind": "this_company",
    "web_query": None,
}


def completion(content: Any, usage: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "choices": [{"message": {"role": "assistant", "content": content}}],
        "usage": usage or {"prompt_tokens": 1000, "completion_tokens": 100},
    }


@pytest.fixture
async def budget(tmp_path: Path) -> AsyncIterator[Budget]:
    ledger = Ledger(tmp_path / "iris.db")
    await ledger.open()
    yield Budget(ledger, Settings(_env_file=None, iris_env="test", data_dir=tmp_path))  # type: ignore[call-arg]
    await ledger.close()


@pytest.fixture
async def llm(budget: Budget) -> AsyncIterator[GatewayLLMClient]:
    async def no_sleep(_: float) -> None:
        return None

    http = gateway_http_client("raw-test-key")
    yield GatewayLLMClient(http, budget, sleep=no_sleep)
    await http.aclose()


def task(model: str = "claude-sonnet-5") -> LlmTask[AskPageAnswer]:
    return LlmTask(
        name="ask_page_answer",
        output=AskPageAnswer,
        model=model,
        purpose="ask_page",
        messages=build_messages("ask_page", "PAGE: Terms\nSECTIONS:\n[s-1] text", "QUESTION: q"),
        max_tokens=800,
        timeout=25.0,
    )


@respx.mock
async def test_request_shape(llm: GatewayLLMClient) -> None:
    route = respx.post(URL).mock(
        return_value=httpx.Response(200, json=completion(json.dumps(ANSWER)))
    )
    answer = await llm.complete(task(model="claude-sonnet-4-6"))
    assert answer.topic == "Cancellation"
    request = route.calls.last.request
    assert request.headers["authorization"] == "raw-test-key"
    assert request.headers["content-type"] == "application/json"
    body = json.loads(request.content)
    assert body["model"] == "claude-sonnet-4-6"
    assert body["temperature"] == 0.2
    assert body["max_tokens"] == 800
    assert body["model_region"] == "global"
    assert body["post_processing_steps"] == [{"type": "json-repair"}]
    response_format = body["response_format"]
    assert response_format["type"] == "json_schema"
    assert response_format["json_schema"]["name"] == "ask_page_answer"
    assert response_format["json_schema"]["strict"] is True
    messages = body["messages"]
    assert [m["role"] for m in messages] == ["system", "user", "user"]
    assert "cache_control" not in messages[0]
    assert messages[1]["cache_control"] == {"type": "ephemeral", "ttl": "5m"}
    assert messages[1]["content"].startswith("PAGE: Terms")
    assert "cache_control" not in messages[2]


@respx.mock
async def test_schema_in_prompt_for_sonnet_5(llm: GatewayLLMClient) -> None:
    # The Gateway rejects temperature and response_format for claude-sonnet-5.
    fenced = "```json\n" + json.dumps(ANSWER) + "\n```"
    route = respx.post(URL).mock(return_value=httpx.Response(200, json=completion(fenced)))
    answer = await llm.complete(task(model="claude-sonnet-5"))
    assert answer.topic == "Cancellation"
    body = json.loads(route.calls.last.request.content)
    assert "temperature" not in body
    assert "response_format" not in body
    assert body["post_processing_steps"] == [{"type": "json-repair"}]
    assert body["model_region"] == "global"
    system = body["messages"][0]
    assert system["role"] == "system"
    assert 'JSON schema "ask_page_answer"' in system["content"]
    assert '"answer_type"' in system["content"]
    assert body["messages"][1]["cache_control"] == {"type": "ephemeral", "ttl": "5m"}


def test_schema_instruction_without_a_system_message() -> None:
    from app.services.llm import with_schema_instruction

    messages = with_schema_instruction([{"role": "user", "content": "hi"}], "x", {"type": "object"})
    assert messages[0]["role"] == "system"
    assert messages[0]["content"].startswith("Reply with only a JSON object")


def claude_usage(uncached: int, read: int, write: int, out: int) -> dict[str, Any]:
    """Usage as the Gateway reports it for Claude: prompt_tokens leaves out the cache."""
    return {
        "prompt_tokens": uncached,
        "completion_tokens": out,
        "prompt_tokens_details": {
            "cached_tokens": read,
            "cache_creation": {"ephemeral_5m_input_tokens": write, "ephemeral_1h_input_tokens": 0},
        },
    }


@respx.mock
async def test_cache_reads_are_charged_at_full_price(llm: GatewayLLMClient, budget: Budget) -> None:
    usage = claude_usage(uncached=14, read=4276, write=0, out=300)
    respx.post(URL).mock(
        return_value=httpx.Response(200, json=completion(json.dumps(ANSWER), usage))
    )
    await llm.complete(task())
    # (14 + 4,276) × $3/M + 300 × $15/M
    assert await budget.ledger.llm_spend_since(0) == pytest.approx(0.01737)
    async with budget.ledger.db.execute(
        "SELECT purpose, prompt_tokens, cached_tokens, completion_tokens FROM llm_calls"
    ) as cursor:
        assert await cursor.fetchall() == [("ask_page", 4290, 4276, 300)]


@respx.mock
async def test_cache_writes_are_charged_at_the_write_price(
    llm: GatewayLLMClient, budget: Budget
) -> None:
    usage = claude_usage(uncached=14, read=0, write=4276, out=300)
    respx.post(URL).mock(
        return_value=httpx.Response(200, json=completion(json.dumps(ANSWER), usage))
    )
    await llm.complete(task())
    # (14 + 4,276 × 1.25) × $3/M + 300 × $15/M
    assert await budget.ledger.llm_spend_since(0) == pytest.approx(0.020577)


@respx.mock
async def test_missing_usage_counts_the_estimate(llm: GatewayLLMClient, budget: Budget) -> None:
    body = {"choices": [{"message": {"content": json.dumps(ANSWER)}}]}
    respx.post(URL).mock(return_value=httpx.Response(200, json=body))
    await llm.complete(task())
    assert await budget.ledger.llm_spend_since(0) > 0.01  # 800 output tokens at $15/M alone


@respx.mock
async def test_retries_once_on_server_error(llm: GatewayLLMClient) -> None:
    route = respx.post(URL).mock(
        side_effect=[httpx.Response(503), httpx.Response(200, json=completion(json.dumps(ANSWER)))]
    )
    await llm.complete(task())
    assert route.call_count == 2


@respx.mock
async def test_gives_up_after_two_rate_limits(llm: GatewayLLMClient) -> None:
    route = respx.post(URL).mock(return_value=httpx.Response(429))
    with pytest.raises(IrisError) as caught:
        await llm.complete(task())
    assert caught.value.code == "upstream_error"
    assert route.call_count == 2


@respx.mock
async def test_timeouts_become_upstream_timeout(llm: GatewayLLMClient) -> None:
    route = respx.post(URL).mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(IrisError) as caught:
        await llm.complete(task())
    assert caught.value.code == "upstream_timeout"
    assert route.call_count == 2


@respx.mock
async def test_client_errors_are_not_retried(llm: GatewayLLMClient) -> None:
    route = respx.post(URL).mock(return_value=httpx.Response(400, json={"error": "bad"}))
    with pytest.raises(IrisError):
        await llm.complete(task())
    assert route.call_count == 1


@respx.mock
async def test_invalid_output_is_retried_with_the_error(llm: GatewayLLMClient) -> None:
    route = respx.post(URL).mock(
        side_effect=[
            httpx.Response(200, json=completion('{"say": "missing fields"}')),
            httpx.Response(200, json=completion(json.dumps(ANSWER))),
        ]
    )
    answer = await llm.complete(task())
    assert answer.answer_type == "from_page"
    retry_messages = json.loads(route.calls.last.request.content)["messages"]
    assert retry_messages[-2]["role"] == "assistant"
    assert "didn't match the schema" in retry_messages[-1]["content"]


@respx.mock
async def test_invalid_output_twice_is_an_error(llm: GatewayLLMClient) -> None:
    respx.post(URL).mock(return_value=httpx.Response(200, json=completion("not json")))
    with pytest.raises(IrisError) as caught:
        await llm.complete(task())
    assert caught.value.code == "upstream_error"


@respx.mock
async def test_content_parts_are_joined(llm: GatewayLLMClient) -> None:
    parts = [{"type": "text", "text": json.dumps(ANSWER)}]
    respx.post(URL).mock(return_value=httpx.Response(200, json=completion(parts)))
    assert (await llm.complete(task())).topic == "Cancellation"


@respx.mock
async def test_unknown_model_is_refused_without_a_call(llm: GatewayLLMClient) -> None:
    route = respx.post(URL)
    with pytest.raises(IrisError) as caught:
        await llm.complete(task(model="mystery-model"))
    assert caught.value.code == "upstream_error"
    assert route.call_count == 0


@respx.mock
async def test_call_refused_when_estimate_passes_the_cap(
    llm: GatewayLLMClient, budget: Budget
) -> None:
    budget.settings.budget_daily_usd = 0.005
    route = respx.post(URL)
    with pytest.raises(IrisError) as caught:
        await llm.complete(task())
    assert caught.value.code == "budget_exhausted_daily"
    assert route.call_count == 0


def test_strict_schema() -> None:
    schema = strict_schema(ScanFindings)
    text = json.dumps(schema)
    for keyword in ('"title"', '"default"', '"maxLength"', '"maxItems"'):
        # "title" survives only as a property name inside Finding.
        assert text.count(keyword) == (1 if keyword == '"title"' else 0) or keyword == '"title"'

    def objects(node: Any) -> list[dict[str, Any]]:
        found = []
        if isinstance(node, dict):
            if node.get("type") == "object":
                found.append(node)
            for value in node.values():
                found += objects(value)
        elif isinstance(node, list):
            for value in node:
                found += objects(value)
        return found

    for obj in objects(schema):
        assert obj["additionalProperties"] is False
        assert obj["required"] == list(obj["properties"])
    finding = schema["$defs"]["Finding"]
    assert "title" in finding["properties"]
    assert "title" in finding["required"]


def test_strict_schema_makes_optional_fields_required_but_nullable() -> None:
    schema = strict_schema(AskPageAnswer)
    assert "quote" in schema["required"]
    assert {"type": "null"} in schema["properties"]["quote"]["anyOf"]
