from fastapi import APIRouter, FastAPI

from app.config import Settings, get_settings
from app.errors import install_error_handlers
from app.logging import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="workstation-saas")
    app.state.settings = settings
    install_error_handlers(app)

    router = APIRouter(prefix="/api/v1")

    @router.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)
    return app
