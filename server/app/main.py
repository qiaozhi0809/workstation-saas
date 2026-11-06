import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import APIRouter, FastAPI
from redis import Redis
from sqlalchemy import create_engine

from app.auth.router import router as auth_router
from app.config import Settings, get_settings
from app.deploy.system_router import router as system_router  # M5a 段 A
from app.domain.accounts.router import router as accounts_router  # M3a 段 E
from app.domain.accounts.security_router import router as account_security_router  # M5b 段 A
from app.domain.ai.router import router as ai_router
from app.domain.ai_admin.router import router as ai_admin_router  # M3b 段 D
from app.domain.attendance.router import router as attendance_router
from app.domain.audit_query.router import router as audit_query_router  # M3b 段 D
from app.domain.cameras.playback_router import router as camera_playback_router  # M5c 段 A
from app.domain.cameras.router import router as cameras_router  # M5c 段 A
from app.domain.cameras.view_router import router as camera_view_router  # M5c 段 A
from app.domain.classes.router import router as classes_router
from app.domain.classroom.router import router as classroom_router
from app.domain.comments.router import router as comments_router
from app.domain.exams.router import router as exams_router
from app.domain.grade_exams.router import router as grade_exams_router  # M3b 段 C
from app.domain.growth.router import router as growth_router
from app.domain.history.router import router as history_router  # M3b 段 H
from app.domain.login_logs.router import router as login_logs_router  # M5b 段 A
from app.domain.notices.acks_router import router as acks_router  # M4b 段 A
from app.domain.notices.class_router import router as class_notices_router  # M4b 段 A
from app.domain.notices.router import router as notices_router  # M3b 段 E
from app.domain.org.router import router as org_router  # M3a 段 D
from app.domain.overview.router import router as overview_router  # M3a 段 F
from app.domain.parents.manage_router import router as parent_manage_router  # M4a 段 C
from app.domain.parents.views_router import router as parent_views_router  # M4a 段 D
from app.domain.preferences.router import router as preferences_router
from app.domain.reports.attendance_router import router as attendance_report_router  # M3b 段 D
from app.domain.reports.router import router as reports_router  # M3b 段 C
from app.domain.reviews.router import router as reviews_router
from app.domain.roster.router import router as roster_router
from app.domain.school_settings.router import router as school_settings_router  # M3a 段 E
from app.domain.school_settings.security_router import (
    router as security_settings_router,
)  # M5b 段 A
from app.domain.seating.router import router as seating_router
from app.domain.students.router import router as students_router
from app.domain.timetable.router import router as timetable_router  # M5c 段 A
from app.domain.todos.router import router as todos_router
from app.domain.years.http import router as years_router  # M3b 段 F
from app.errors import install_error_handlers
from app.logging import configure_logging
from app.version import APP_VERSION
from app.ws.hub import Hub
from app.ws.router import router as ws_router  # M3b 段 A


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_dir, settings.log_retention_days)
    structlog.get_logger().info("app.started", version=APP_VERSION, env=settings.env)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        task = asyncio.create_task(app.state.hub.run(app.state.settings.redis_url))
        try:
            try:
                await asyncio.wait_for(app.state.hub.subscribed.wait(), 3)
            except TimeoutError:
                logging.getLogger(__name__).warning("ws hub not subscribed yet; continuing")
            yield
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    app = FastAPI(title="workstation-saas", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = create_engine(settings.database_url, pool_pre_ping=True)
    app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
    app.state.hub = Hub()
    app.state.ws_auth_timeout = 5.0
    app.state.ws_ping_interval = 25.0
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
    router.include_router(overview_router)  # M3a 段 F
    router.include_router(accounts_router)  # M3a 段 E
    router.include_router(school_settings_router)  # M3a 段 E
    router.include_router(org_router)  # M3a 段 D
    router.include_router(ws_router)  # M3b 段 A
    router.include_router(grade_exams_router)  # M3b 段 C
    router.include_router(reports_router)  # M3b 段 C
    router.include_router(attendance_report_router)  # M3b 段 D
    router.include_router(audit_query_router)  # M3b 段 D
    router.include_router(ai_admin_router)  # M3b 段 D
    router.include_router(notices_router)  # M3b 段 E
    router.include_router(years_router)  # M3b 段 F
    router.include_router(history_router)  # M3b 段 H
    router.include_router(parent_manage_router)  # M4a 段 C
    router.include_router(parent_views_router)  # M4a 段 D
    router.include_router(acks_router)  # M4b 段 A
    router.include_router(class_notices_router)  # M4b 段 A
    router.include_router(system_router)  # M5a 段 A
    router.include_router(security_settings_router)  # M5b 段 A
    router.include_router(account_security_router)  # M5b 段 A
    router.include_router(login_logs_router)  # M5b 段 A
    router.include_router(timetable_router)  # M5c 段 A
    router.include_router(cameras_router)  # M5c 段 A
    router.include_router(camera_view_router)  # M5c 段 A
    router.include_router(camera_playback_router)  # M5c 段 A
    app.include_router(router)
    return app
