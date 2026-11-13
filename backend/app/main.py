"""Створення FastAPI-застосунку NeVpade."""
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import db
from .config import settings
from .errors import register_error_handlers
from .routers import analytics, auth, chat, company, documents, drivers, imports, profile, tasks, trips, vehicles

logging.basicConfig(level=logging.DEBUG if settings.debug else logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("nevpade")

# Зібраний фронтенд (npm run build:server). Якщо він є — сайт і API працюють з однієї адреси:
# «/» — головна сторінка з «Почати роботу», «/pages/…» — сторінки застосунку, «/api/…» — API.
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST") or Path(__file__).resolve().parents[2] / "frontend" / "dist")


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

    # documents — перед vehicles/drivers, щоб /vehicles/documents/summary не сприймався як /vehicles/{id}
    for router in (auth, profile, company, chat, trips, documents, vehicles, drivers, tasks, analytics, imports):
        app.include_router(router.router, prefix="/api")

    @app.get("/api", include_in_schema=False)
    async def api_root():
        return {"name": "NeVpade API", "docs": "/docs", "health": "/api/health"}

    @app.get("/api/health", tags=["Службове"])
    async def health():
        await db.get_db().command("ping")
        return {"status": "ok"}

    if (FRONTEND_DIST / "index.html").is_file():
        # Монтуємо останнім, щоб маршрути /api і /docs мали пріоритет
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
        log.info("Фронтенд: віддаю сайт з %s", FRONTEND_DIST)
    else:
        @app.get("/", include_in_schema=False)
        async def root():
            return {"name": "NeVpade API", "docs": "/docs", "health": "/api/health",
                    "hint": "Сайт не зібрано: cd frontend && npm run build:server"}

    return app


app = create_app()
