"""App factory: middleware, routers and lifespan."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.errors import install_error_handlers
from app.logging import setup_logging
from app.middleware import (
    BodySizeLimitMiddleware,
    ContractHeaderMiddleware,
    RequestContextMiddleware,
)
from app.routers import agent, health, journey, pages, tools
from app.schemas.api import ErrorEnvelope
from app.services.container import build_services
from app.settings import Settings, get_settings

ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    "4XX": {"model": ErrorEnvelope, "description": "Error envelope"},
    "5XX": {"model": ErrorEnvelope, "description": "Error envelope"},
}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    services = await build_services(app.state.settings)
    app.state.services = services
    services.start_background()
    try:
        yield
    finally:
        await services.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    setup_logging(settings.log_level)

    app = FastAPI(
        title="Iris API",
        version=health.VERSION,
        openapi_url="/api/openapi.json",
        docs_url=None if settings.iris_env == "prod" else "/api/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = settings

    # add_middleware wraps outside-in, so these run in the reverse of the order added:
    # request context → body size limit → CORS → contract header.
    app.add_middleware(ContractHeaderMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Iris-Contract"],
    )
    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(RequestContextMiddleware)

    install_error_handlers(app)
    for router in (health.router, agent.router, pages.router, tools.router, journey.router):
        app.include_router(router, prefix="/api", responses=ERROR_RESPONSES)
    return app


app = create_app()
