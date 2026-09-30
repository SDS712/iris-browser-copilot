"""Agent config: the tools, greet=false, the voice choice, and the session matching the
AssemblyAI docs."""

import json
from pathlib import Path
from typing import Any

import httpx

from app.services.agent_config import tool_definitions
from app.settings import Settings

FIXTURES = Path(__file__).parent / "fixtures"


def assert_shape_matches(ours: Any, example: Any, path: str) -> None:
    """Every key we send must exist in the documented example, with the same JSON type."""
    if isinstance(example, dict):
        assert isinstance(ours, dict), path
        for key, value in ours.items():
            assert key in example, f"{path}.{key} is not in AssemblyAI's documented session"
            assert_shape_matches(value, example[key], f"{path}.{key}")
    elif isinstance(example, list):
        assert isinstance(ours, list), path
    else:
        assert type(ours) is type(example), f"{path}: {type(ours)} vs {type(example)}"


async def test_session_matches_docs_example(client: httpx.AsyncClient) -> None:
    example = json.loads((FIXTURES / "assemblyai_session_update_example.json").read_text())
    body = (await client.get("/api/agent-config")).json()
    session = body["session"]
    tools = session.pop("tools")
    assert_shape_matches(session, example["session"], "session")
    documented_tool = example["session"]["tools"][0]
    for tool in tools:
        assert set(tool) <= set(documented_tool), tool["name"]
        assert tool["type"] == "function"
        assert tool["execution_mode"] == "interactive"
        assert tool["timeout_seconds"] == 30
        assert tool["parameters"]["type"] == "object"


async def test_agent_config_contents(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/agent-config?greet=true")
    assert response.status_code == 200
    body = response.json()
    assert body["contract_version"] == 1
    assert body["max_session_seconds"] == 600
    assert body["warn_before_end_seconds"] == 60
    session = body["session"]
    assert session["greeting"] == (
        "Hi, I'm Iris. Ask me anything about this page, or say 'what should I know?'"
    )
    assert session["system_prompt"].startswith("You are Iris, a voice copilot")
    assert session["output"]["voice"] == Settings().iris_voice_female
    keyterms = session["input"]["keyterms"]
    assert len(keyterms) <= 100
    for term in ("IFSC", "NACH", "UPI AutoPay", "QuickCred", "Nimbus"):
        assert term in keyterms
    assert [tool["name"] for tool in session["tools"]] == [t["name"] for t in tool_definitions()]


async def test_greet_false_leaves_out_greeting(client: httpx.AsyncClient) -> None:
    body = (await client.get("/api/agent-config?greet=false")).json()
    assert "greeting" not in body["session"]


async def test_voice_choice_picks_the_voice_id(client: httpx.AsyncClient) -> None:
    settings = Settings()
    male = (await client.get("/api/agent-config?voice=male")).json()
    female = (await client.get("/api/agent-config?voice=female")).json()
    assert male["session"]["output"]["voice"] == settings.iris_voice_male == "alba"
    assert female["session"]["output"]["voice"] == settings.iris_voice_female
    assert settings.iris_voice_female != settings.iris_voice_male


async def test_unknown_voice_is_rejected(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/agent-config?voice=robot")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
