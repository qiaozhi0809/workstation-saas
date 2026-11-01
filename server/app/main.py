from fastapi import APIRouter, FastAPI
from redis import Redis
from sqlalchemy import create_engine

from app.auth.router import router as auth_router
from app.config import Settings, get_settings
from app.domain.attendance.router import router as attendance_router
from app.domain.classes.router import router as classes_router
from app.domain.classroom.router import router as classroom_router
from app.domain.reviews.router import router as reviews_router
from app.domain.students.router import router as students_router
from app.errors import install_error_handlers
from app.logging import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="workstation-saas")
    app.state.settings = settings
    app.state.engine = create_engine(settings.database_url, pool_pre_ping=True)
    app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
    install_error_handlers(app)

    router = APIRouter(prefix="/api/v1")

    @router.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    router.include_router(auth_router)
    router.include_router(classes_router)
    router.include_router(classroom_router)
    router.include_router(attendance_router)
    router.include_router(students_router)
    router.include_router(reviews_router)
    app.include_router(router)
    return app
