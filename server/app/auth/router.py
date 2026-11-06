from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from redis import Redis
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.deps import get_current_user, get_current_user_pending
from app.auth.service import UserBrief
from app.config import Settings, settings_dep
from app.db import get_db
from app.domain.school_settings.service import get_security
from app.models import User
from app.redis import get_redis

DbDep = Annotated[Session, Depends(get_db)]
RedisDep = Annotated[Redis, Depends(get_redis)]
SettingsDep = Annotated[Settings, Depends(settings_dep)]
CurrentUser = Annotated[User, Depends(get_current_user_pending)]
FullUser = Annotated[User, Depends(get_current_user)]  # M5b 段 A

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


class LoginTotpRequest(BaseModel):  # M5b 段 A
    mfa_token: str = Field(min_length=1, max_length=256)
    code: str = Field(min_length=1, max_length=16)


class TotpEnableRequest(BaseModel):  # M5b 段 A
    password: str = Field(min_length=1, max_length=256)
    code: str = Field(min_length=1, max_length=16)
    refresh_token: str = Field(min_length=1, max_length=256)


class TotpDisableRequest(BaseModel):  # M5b 段 A
    password: str = Field(min_length=1, max_length=256)


class MfaChallenge(BaseModel):  # M5b 段 A
    mfa_required: Literal[True] = True
    mfa_token: str
    expires_in: int


class TotpStatusResponse(BaseModel):  # M5b 段 A
    allowed: bool
    enabled: bool
    enabled_at: datetime | None


class TotpSetupResponse(BaseModel):  # M5b 段 A
    secret: str
    otpauth_uri: str
    qr_svg: str


class TotpEnabledResponse(BaseModel):  # M5b 段 A
    enabled: bool


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


def _login_response(db: Session, result: service.LoginResult) -> LoginResponse:
    return LoginResponse(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        expires_at=result.expires_at,
        user=service.user_brief(db, result.user),
    )


@router.post("/login")
def login(
    body: LoginRequest,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    request: Request,
) -> LoginResponse | MfaChallenge:
    result = service.login(db, redis, settings, body.login_name, body.password, request)
    if isinstance(result, service.MfaChallengeResult):  # M5b 段 A
        return MfaChallenge(mfa_token=result.mfa_token, expires_in=result.expires_in)
    return _login_response(db, result)


@router.post("/login/totp")
def login_totp(
    body: LoginTotpRequest,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    request: Request,
) -> LoginResponse:  # M5b 段 A
    result = service.login_totp(db, redis, settings, body.mfa_token, body.code, request)
    return _login_response(db, result)


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


class PasswordPolicyResponse(BaseModel):  # M5b 段 A
    min_length: int
    max_age_days: int


@router.get("/password-policy")
def password_policy(user: CurrentUser, db: DbDep) -> PasswordPolicyResponse:  # M5b 段 A
    sec = get_security(db, user.school_id)
    return PasswordPolicyResponse(
        min_length=sec.password_min_length, max_age_days=sec.password_max_age_days
    )


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


@router.get("/totp")
def totp_status(user: FullUser, db: DbDep, settings: SettingsDep) -> TotpStatusResponse:  # M5b 段 A
    st = service.totp_status(db, user, settings)
    return TotpStatusResponse(allowed=st.allowed, enabled=st.enabled, enabled_at=st.enabled_at)


@router.post("/totp/setup")
def totp_setup(
    user: FullUser, db: DbDep, redis: RedisDep, settings: SettingsDep, response: Response
) -> TotpSetupResponse:  # M5b 段 A
    response.headers["Cache-Control"] = "no-store"
    secret, uri, svg = service.totp_setup(db, redis, settings, user)
    return TotpSetupResponse(secret=secret, otpauth_uri=uri, qr_svg=svg)


@router.post("/totp/enable")
def totp_enable(
    body: TotpEnableRequest,
    user: FullUser,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    request: Request,
) -> TotpEnabledResponse:  # M5b 段 A
    service.totp_enable(
        db, redis, settings, user, body.password, body.code, body.refresh_token, request
    )
    return TotpEnabledResponse(enabled=True)


@router.post("/totp/disable")
def totp_disable(
    body: TotpDisableRequest,
    user: FullUser,
    db: DbDep,
    redis: RedisDep,
    settings: SettingsDep,
    request: Request,
) -> TotpEnabledResponse:  # M5b 段 A
    service.totp_disable(db, redis, settings, user, body.password, request)
    return TotpEnabledResponse(enabled=False)
