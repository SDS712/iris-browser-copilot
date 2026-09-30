"""JSON log lines and request IDs.

Log records carry structured fields under `extra={"iris": {...}}`. Only fields
named in ALLOWED_FIELDS are written, so page text, questions, labels and URLs
can't slip into a log line by accident.
"""

import hashlib
import json
import logging
import secrets
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

ALLOWED_FIELDS = frozenset(
    {
        "route",
        "method",
        "status",
        "duration_ms",
        "ip_hash",
        "model",
        "purpose",
        "prompt_tokens",
        "cached_tokens",
        "completion_tokens",
        "cost_usd",
        "credits",
        "domain",
        "upstream",
        "code",
        "attempt",
        "today_usd",
        "total_usd",
        "cap_usd",
        "sessions",
        "page_type",
        "scan_kind",
        "risks",
    }
)

# One salt per process: hashed IPs can be compared within a run, never reversed.
_IP_SALT = secrets.token_bytes(16)


def hash_ip(ip: str) -> str:
    return hashlib.sha256(_IP_SALT + ip.encode()).hexdigest()[:16]


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line: dict[str, Any] = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        request_id = request_id_var.get()
        if request_id:
            line["request_id"] = request_id
        fields = getattr(record, "iris", None)
        if isinstance(fields, dict):
            line.update({k: v for k, v in fields.items() if k in ALLOWED_FIELDS})
        if record.exc_info:
            line["exc"] = self.formatException(record.exc_info)
        return json.dumps(line, ensure_ascii=False, default=str)


def setup_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # Uvicorn's own access log includes query strings; ours replaces it.
    logging.getLogger("uvicorn.access").disabled = True
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True
    # httpx logs full request URLs at INFO, which would include queries.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
