"""Створення FastAPI-застосунку NeVpade."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import settings
from .errors import register_error_handlers
from .routers import analytics, auth, chat, company, drivers, profile, tasks, trips, vehicles

logging.basicConfig(level=logging.DEBUG if settings.debug else logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.connect()
    yield
    await db.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="NeVpade API",
        description="Серверна частина інформаційної вебсистеми для менеджера вантажоперевезень",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(app)

    for router in (auth, profile, company, chat, trips, vehicles, drivers, tasks, analytics):
        app.include_router(router.router, prefix="/api")

    @app.get("/", include_in_schema=False)
    async def root():
        return {"name": "NeVpade API", "docs": "/docs", "health": "/api/health"}

    @app.get("/api/health", tags=["Службове"])
    async def health():
        await db.get_db().command("ping")
        return {"status": "ok"}

    return app


app = create_app()
