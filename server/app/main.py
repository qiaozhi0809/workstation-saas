from fastapi import APIRouter, FastAPI
from redis import Redis
from sqlalchemy import create_engine

from app.auth.router import router as auth_router
from app.config import Settings, get_settings
from app.domain.ai.router import router as ai_router
from app.domain.attendance.router import router as attendance_router
from app.domain.classes.router import router as classes_router
from app.domain.classroom.router import router as classroom_router
from app.domain.comments.router import router as comments_router
from app.domain.exams.router import router as exams_router
from app.domain.growth.router import router as growth_router
from app.domain.org.router import router as org_router  # M3a 段 D
from app.domain.preferences.router import router as preferences_router
from app.domain.reviews.router import router as reviews_router
from app.domain.roster.router import router as roster_router
from app.domain.seating.router import router as seating_router
from app.domain.students.router import router as students_router
from app.domain.todos.router import router as todos_router
from app.errors import install_error_handlers
from app.logging import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="workstation-saas")
    app.state.settings = settings
    app.state.engine = create_engine(settings.database_url, pool_pre_ping=True)
    app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
    app.state.ai_transport = None  # None = 真实网络;测试里注入假传输
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
    router.include_router(seating_router)
    router.include_router(todos_router)
    router.include_router(preferences_router)
    router.include_router(exams_router)
    router.include_router(growth_router)
    router.include_router(comments_router)
    router.include_router(roster_router)
    router.include_router(ai_router)
    router.include_router(org_router)  # M3a 段 D
    app.include_router(router)
    return app
