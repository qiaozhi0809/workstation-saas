from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from redis import Redis
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.deps import get_current_user
from app.config import Settings, settings_dep
from app.db import get_db
from app.models import User
from app.redis import get_redis

DbDep = Annotated[Session, Depends(get_db)]
RedisDep = Annotated[Redis, Depends(get_redis)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
CurrentUser = Annotated[User, Depends(get_current_user)]

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    login_name: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=256)


class UserBrief(BaseModel):
    id: UUID
    display_name: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_at: datetime
    user: UserBrief


class RefreshResponse(BaseModel):
    access_token: str
    expires_at: datetime


class OkResponse(BaseModel):
    ok: bool


class MeResponse(BaseModel):
    id: UUID
    display_name: str
    login_name: str


@router.post("/login")
def login(
    body: LoginRequest,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
) -> LoginResponse:
    result = service.login(db, redis, settings, body.login_name, body.password)
    return LoginResponse(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        expires_at=result.expires_at,
        user=UserBrief(id=result.user.id, display_name=result.user.display_name),
    )


@router.post("/refresh")
def refresh(
    body: RefreshRequest,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
) -> RefreshResponse:
    access_token, expires_at = service.refresh(db, redis, settings, body.refresh_token)
    return RefreshResponse(access_token=access_token, expires_at=expires_at)


@router.post("/logout")
def logout(body: RefreshRequest, redis: RedisDep) -> OkResponse:
    service.logout(redis, body.refresh_token)
    return OkResponse(ok=True)


@router.get("/me")
def me(user: CurrentUser) -> MeResponse:
    return MeResponse(id=user.id, display_name=user.display_name, login_name=user.login_name)
