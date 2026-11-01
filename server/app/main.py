from fastapi import APIRouter, FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="workstation-saas")
    router = APIRouter(prefix="/api/v1")

    @router.get("/healthz")
    def healthz() -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)
    return app
