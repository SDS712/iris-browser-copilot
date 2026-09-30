"""The voice agent configuration sent as AssemblyAI's session.update body."""

import json
from functools import cache
from pathlib import Path
from typing import Any, Literal

from app.schemas.api import AgentSession, AudioFormat, SessionInput, SessionOutput
from app.settings import Settings

APP_DIR = Path(__file__).resolve().parents[1]
GREETING = "Hi, I'm Iris. Ask me anything about this page, or say 'what should I know?'"
MAX_KEYTERMS = 100
TOOL_TIMEOUT_SECONDS = 30
WARN_BEFORE_END_SECONDS = 60

VoiceChoice = Literal["female", "male"]


@cache
def system_prompt() -> str:
    return (APP_DIR / "prompts" / "system_prompt.md").read_text(encoding="utf-8").strip()


@cache
def keyterms() -> tuple[str, ...]:
    lines = (APP_DIR / "data" / "keyterms.txt").read_text(encoding="utf-8").splitlines()
    return tuple(line.strip() for line in lines if line.strip())[:MAX_KEYTERMS]


@cache
def tool_definitions() -> tuple[dict[str, Any], ...]:
    """The nine tools the voice agent can call."""
    tools = json.loads((APP_DIR / "agent_tools.json").read_text(encoding="utf-8"))
    return tuple(tools)


def session_tools() -> list[dict[str, Any]]:
    # Every tool is interactive with a 30-second timeout. AssemblyAI's
    # defaults differ (120 s), so both are set explicitly.
    return [
        {**tool, "execution_mode": "interactive", "timeout_seconds": TOOL_TIMEOUT_SECONDS}
        for tool in tool_definitions()
    ]


def voice_id(settings: Settings, voice: VoiceChoice) -> str:
    return settings.iris_voice_female if voice == "female" else settings.iris_voice_male


def build_session(settings: Settings, greet: bool, voice: VoiceChoice = "female") -> AgentSession:
    return AgentSession(
        system_prompt=system_prompt(),
        greeting=GREETING if greet else None,
        input=SessionInput(format=AudioFormat(), keyterms=list(keyterms())),
        output=SessionOutput(voice=voice_id(settings, voice), format=AudioFormat()),
        tools=session_tools(),
    )
