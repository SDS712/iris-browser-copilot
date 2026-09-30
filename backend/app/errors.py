"""IrisError and the handlers that turn every failure into the error envelope."""

import logging
from enum import StrEnum
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("iris.errors")


class ErrorCode(StrEnum):
    INVALID_REQUEST = "invalid_request"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    PAGE_NOT_FOUND = "page_not_found"
    RATE_LIMITED = "rate_limited"
    BUDGET_EXHAUSTED_DAILY = "budget_exhausted_daily"
    SERVICE_CLOSED = "service_closed"
    UPSTREAM_ERROR = "upstream_error"
    UPSTREAM_TIMEOUT = "upstream_timeout"
    INTERNAL_ERROR = "internal_error"


STATUS: dict[ErrorCode, int] = {
    ErrorCode.INVALID_REQUEST: 400,
    ErrorCode.PAYLOAD_TOO_LARGE: 413,
    ErrorCode.PAGE_NOT_FOUND: 404,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.BUDGET_EXHAUSTED_DAILY: 429,
    ErrorCode.SERVICE_CLOSED: 503,
    ErrorCode.UPSTREAM_ERROR: 502,
    ErrorCode.UPSTREAM_TIMEOUT: 504,
    ErrorCode.INTERNAL_ERROR: 500,
}

# Interface copy and agent guidance per code.
DEFAULT_MESSAGES: dict[ErrorCode, tuple[str, str]] = {
    ErrorCode.INVALID_REQUEST: (
        "Something went wrong with that request.",
        "That request didn't work. Tell the user briefly that something went wrong.",
    ),
    ErrorCode.PAYLOAD_TOO_LARGE: (
        "I could only read part of this page.",
        "The page is too large to read in one go. Tell the user you could only read part of it.",
    ),
    ErrorCode.PAGE_NOT_FOUND: (
        "I lost track of this page. Let me read it again.",
        "The page needs to be read again. Tell the user to give you a moment and ask again.",
    ),
    ErrorCode.RATE_LIMITED: (
        "Too many requests, try again in a minute.",
        "There have been too many requests. Tell the user to try again in a minute.",
    ),
    ErrorCode.BUDGET_EXHAUSTED_DAILY: (
        "The demo has hit today's limit. Please try again tomorrow.",
        "The live demo has reached today's usage limit, so I can't do that right now. "
        "Apologise briefly and suggest trying again tomorrow.",
    ),
    ErrorCode.SERVICE_CLOSED: (
        "The live demo is closed for now. You can still watch the video.",
        "The live demo is closed, so I can't do that. "
        "Apologise briefly and tell the user they can still watch the video.",
    ),
    ErrorCode.UPSTREAM_ERROR: (
        "I can't reach my tools right now. Try again in a moment.",
        "A service I rely on failed. Tell the user you can't do that right now "
        "and suggest trying again in a moment.",
    ),
    ErrorCode.UPSTREAM_TIMEOUT: (
        "That took too long. Try again in a moment.",
        "A service I rely on took too long to answer. Tell the user you couldn't finish "
        "and suggest trying again in a moment.",
    ),
    ErrorCode.INTERNAL_ERROR: (
        "Something went wrong on my side. Try again in a moment.",
        "Something went wrong on the server. Tell the user briefly and suggest trying again.",
    ),
}


class IrisError(Exception):
    """An error that maps to one contract error code."""

    def __init__(
        self,
        code: ErrorCode,
        message: str | None = None,
        agent_message: str | None = None,
        retry_after_seconds: int | None = None,
        status_code: int | None = None,
    ) -> None:
        default_message, default_agent = DEFAULT_MESSAGES[code]
        self.code = code
        self.message = message or default_message
        self.agent_message = agent_message or default_agent
        self.retry_after_seconds = retry_after_seconds
        self.status_code = status_code or STATUS[code]
        super().__init__(f"{code}: {self.message}")

    def envelope(self) -> dict[str, Any]:
        error: dict[str, Any] = {
            "code": str(self.code),
            "message": self.message,
            "agent_message": self.agent_message,
        }
        if self.retry_after_seconds is not None:
            error["retry_after_seconds"] = self.retry_after_seconds
        return {"contract_version": 1, "error": error}


def error_response(error: IrisError) -> JSONResponse:
    headers = {}
    if error.retry_after_seconds is not None:
        headers["Retry-After"] = str(error.retry_after_seconds)
    return JSONResponse(error.envelope(), status_code=error.status_code, headers=headers)


def _validation_message(exc: RequestValidationError) -> str:
    # Only locations and Pydantic's messages: input values could hold page text.
    parts = []
    for item in exc.errors()[:3]:
        loc = ".".join(str(part) for part in item.get("loc", ()) if part != "body")
        parts.append(f"{loc}: {item.get('msg', 'invalid')}" if loc else str(item.get("msg")))
    return "Invalid request. " + "; ".join(parts)


async def _iris_error_handler(_: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, IrisError):
        raise exc
    if exc.code in (ErrorCode.UPSTREAM_ERROR, ErrorCode.UPSTREAM_TIMEOUT):
        logger.warning("upstream failure", extra={"iris": {"code": str(exc.code)}})
    return error_response(exc)


async def _validation_handler(_: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):
        raise exc
    return error_response(IrisError(ErrorCode.INVALID_REQUEST, _validation_message(exc)))


async def _http_handler(_: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):
        raise exc
    message = "Not found." if exc.status_code == 404 else "Request not allowed."
    return error_response(
        IrisError(ErrorCode.INVALID_REQUEST, message, status_code=exc.status_code)
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(IrisError, _iris_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)
    app.add_exception_handler(StarletteHTTPException, _http_handler)
