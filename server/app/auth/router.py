from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from redis import Redis
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.deps import get_current_user_pending
from app.auth.service import UserBrief
from app.config import Settings, settings_dep
from app.db import get_db
from app.models import User
from app.redis import get_redis

DbDep = Annotated[Session, Depends(get_db)]
RedisDep = Annotated[Redis, Depends(get_redis)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
CurrentUser = Annotated[User, Depends(get_current_user_pending)]

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    login_name: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=256)


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)
    refresh_token: str = Field(min_length=1, max_length=256)


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


class MeResponse(UserBrief):
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
        user=service.user_brief(db, result.user),
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
def me(user: CurrentUser, db: DbDep) -> MeResponse:
    brief = service.user_brief(db, user)
    return MeResponse(**brief.model_dump(), login_name=user.login_name)


@router.post("/password")
def change_password(
    body: ChangePasswordRequest,
    user: CurrentUser,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    request: Request,
) -> OkResponse:
    service.change_password(
        db, redis, settings, user, body.old_password, body.new_password, body.refresh_token, request
    )
    return OkResponse(ok=True)
