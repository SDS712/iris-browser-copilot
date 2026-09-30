"""Pure ASGI middleware: request context and access log, body size limit, contract header."""

import logging
import re
import time
import uuid
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import ErrorCode, IrisError, error_response
from app.logging import hash_ip, request_id_var

access_logger = logging.getLogger("iris.access")
error_logger = logging.getLogger("iris.errors")

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
MAX_BODY_BYTES = 450 * 1024


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key == name:
            return str(value.decode("latin-1"))
    return None


def route_template(scope: Scope) -> str:
    """The matched path with parameters put back as {name}; never the raw path of a miss."""
    if "route" not in scope:
        return "unmatched"
    path = str(scope.get("path", ""))
    for name, value in scope.get("path_params", {}).items():
        path = path.replace(f"/{value}", f"/{{{name}}}")
    return path


def client_ip(scope: Scope) -> str:
    client = scope.get("client")
    return str(client[0]) if client else "unknown"


class RequestContextMiddleware:
    """Sets the request ID, writes one JSON access line, and turns crashes into internal_error."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = _header(scope, b"x-request-id")
        request_id = incoming if incoming and _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status = 500
        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status = message["status"]
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            error_logger.exception("unhandled error")
            if not response_started:
                await error_response(IrisError(ErrorCode.INTERNAL_ERROR))(
                    scope, receive, send_wrapper
                )
        finally:
            fields: dict[str, Any] = {
                "route": route_template(scope),
                "method": scope.get("method"),
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                "ip_hash": hash_ip(client_ip(scope)),
            }
            access_logger.info("request", extra={"iris": fields})
            request_id_var.reset(token)


class BodySizeLimitMiddleware:
    """Rejects bodies over the limit, whether or not Content-Length is honest.

    The body is read here (at most the limit) and replayed to the app, because FastAPI
    turns any error raised while it reads the body into a plain 400.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("method") not in ("POST", "PUT", "PATCH"):
            await self.app(scope, receive, send)
            return
        too_large = error_response(IrisError(ErrorCode.PAYLOAD_TOO_LARGE))
        declared = _header(scope, b"content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            await too_large(scope, receive, send)
            return

        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                await self.app(scope, _replay([], message, receive), send)
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.max_bytes:
                await too_large(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        body: Message = {"type": "http.request", "body": b"".join(chunks), "more_body": False}
        await self.app(scope, _replay([body], None, receive), send)


def _replay(messages: list[Message], last: Message | None, receive: Receive) -> Receive:
    pending = [*messages, *([last] if last else [])]

    async def replay() -> Message:
        return pending.pop(0) if pending else await receive()

    return replay


class ContractHeaderMiddleware:
    """Rejects requests that declare a contract version other than 1."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            version = _header(scope, b"x-iris-contract")
            if version is not None and version.strip() != "1":
                error = IrisError(
                    ErrorCode.INVALID_REQUEST,
                    "This version of Iris is out of date. Please update it.",
                )
                await error_response(error)(scope, receive, send)
                return
        await self.app(scope, receive, send)
