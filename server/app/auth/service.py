import base64
import binascii
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID

import structlog
from fastapi import Request
from pydantic import BaseModel
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import clock
from app.audit.service import record
from app.auth import login_log, mfa, sessions, totp
from app.auth.passwords import check_policy, hash_password, verify_password
from app.auth.tokens import issue_access_token
from app.config import Settings
from app.crypto import CryptoError, decrypt, encrypt
from app.domain.school_settings.service import get_security
from app.domain.schools.service import active_academic_year, school_tz
from app.errors import ApiError
from app.models import Notice, NoticeRecipient, RoleBinding, School, User
from app.rbac.admin import admin_perms
from app.rbac.bindings import Binding, load_bindings
from app.rbac.roles import ADMIN_ROLES, PARENT_ROLES, TEACHER_ROLES, Role
from app.ws.hub import STALE, publish

log = structlog.get_logger()


class UserBrief(BaseModel):
    id: UUID
    display_name: str
    contexts: list[str]
    admin_perms: list[str]
    must_change_password: bool
    password_change_reason: Literal["first_login", "expired"] | None


def password_change_reason(
    db: Session, user: User, now: datetime
) -> Literal["first_login", "expired"] | None:
    """必须先改密码的原因:临时密码 / 首次登录优先,其次学校设置的有效期已过。"""
    if user.must_change_password:
        return "first_login"
    max_age = get_security(db, user.school_id).password_max_age_days
    if max_age > 0 and now - user.password_changed_at > timedelta(days=max_age):
        return "expired"
    return None


def _whole_seconds(moment: datetime) -> int:
    """库里是 timestamptz(带时区),clock.utc_now() 也带时区;统一成 UTC 的整秒再比较。"""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return int(moment.timestamp())


def token_is_current(user: User, iat: int) -> bool:
    """令牌签发于密码修改 / 开启两步验证 / 令牌下限之前则为过期(取整到秒:同一秒内签发的放行)。
    下限 token_floor_at 在关闭 / 重置两步验证时写入,免得 totp_enabled_at 清空后旧令牌复活(L144)。
    HTTP 依赖与 WebSocket 鉴权共用这一个判定。"""
    changed = [user.password_changed_at]
    if user.totp_enabled_at is not None:
        changed.append(user.totp_enabled_at)
    if user.token_floor_at is not None:
        changed.append(user.token_floor_at)
    return iat >= max(_whole_seconds(m) for m in changed)


def can_use_api(db: Session, user: User, now: datetime) -> bool:
    return password_change_reason(db, user, now) is None


def contexts_of(bindings: list[Binding]) -> list[str]:
    result = []
    if any(bd.role in TEACHER_ROLES for bd in bindings):
        result.append("teacher")
    if any(bd.role in ADMIN_ROLES for bd in bindings):
        result.append("admin")
    if any(bd.role in PARENT_ROLES for bd in bindings):
        result.append("parent")
    return result


def user_brief(db: Session, user: User) -> UserBrief:
    year = active_academic_year(db, user.school_id)
    bindings = load_bindings(db, user.id, year.id if year else None, include_parents=True)
    reason = password_change_reason(db, user, clock.utc_now())
    return UserBrief(
        id=user.id,
        display_name=user.display_name,
        contexts=contexts_of(bindings),
        admin_perms=admin_perms(bindings),
        must_change_password=reason is not None,
        password_change_reason=reason,
    )


def get_user_by_login(db: Session, school_id: UUID, login_name: str) -> User | None:
    return db.scalar(
        select(User).where(User.school_id == school_id, User.login_name == login_name.strip())
    )


def get_user(db: Session, user_id: UUID) -> User | None:
    return db.get(User, user_id)


@dataclass
class LoginResult:
    access_token: str
    refresh_token: str
    expires_at: datetime
    user: User


@dataclass
class MfaChallengeResult:
    mfa_token: str
    expires_in: int


def _fail_key(settings: Settings, login_name: str) -> str:
    return f"ws:login_fail:{settings.school_id}:{login_name}"


# 用户不存在 / 已冻结时也跑一次同成本的 bcrypt 校验,抹平响应时间差
_DUMMY_HASH = hash_password("dummy-password-for-timing-9f3a1c")


def _retry_after(redis: Redis, settings: Settings, key: str) -> dict[str, str]:
    ttl = redis.ttl(key)
    seconds = settings.login_lock_seconds if ttl is None or ttl < 0 else max(1, ttl)
    return {"Retry-After": str(seconds)}


def _record_failure(redis: Redis, settings: Settings, key: str) -> int:
    # INCR 与 EXPIRE NX 在同一个 MULTI/EXEC 里,避免进程在两步之间崩溃留下永不过期的计数
    pipe = redis.pipeline(transaction=True)
    pipe.incr(key)
    pipe.expire(key, settings.login_lock_seconds, nx=True)
    failures = int(pipe.execute()[0])
    if failures == settings.login_max_failures:
        # 达到上限时重新计时,保证锁定满整个窗口
        redis.expire(key, settings.login_lock_seconds)
    return failures


def _check_not_locked(redis: Redis, settings: Settings, login_name: str, message: str) -> str:
    fail_key = _fail_key(settings, login_name)
    if int(redis.get(fail_key) or 0) >= settings.login_max_failures:
        raise ApiError(
            429, "ACCOUNT_LOCKED", message, headers=_retry_after(redis, settings, fail_key)
        )
    return fail_key


def _log(
    db: Session,
    settings: Settings,
    user: User | None,
    login_name: str,
    result: login_log.LoginOutcome,
    request: Request | None,
) -> login_log.LoginLog | None:
    """写登录日志是尽力而为:出错只告警,不能让登录 / 失败响应变成 500。

    调用点要么已提交(成功路径先 commit 再写日志),要么没有未提交改动(失败路径),
    所以这里 rollback 不会丢状态;失败计数在 Redis,不受影响。
    """
    try:
        return login_log.write(
            db,
            settings,
            user=user,
            login_name=login_name,
            result=result,
            request=request,
            now=clock.utc_now(),
        )
    except Exception as exc:
        db.rollback()
        log.warning("login.log_failed", error=type(exc).__name__)
        return None


_REASON_TEXT = {"night": "凌晨时段", "new_network": "新的网络环境"}
_ALERT_TTL = 2 * 86400


def alert(db: Session, redis: Redis, user: User, entry: login_log.LoginLog) -> None:
    """成功登录且可疑时,给本人和本校在用的信息中心发系统通知;同一用户同一网段每天只提醒一次。"""
    if not entry.suspicious:
        return
    tz = school_tz(db, user.school_id)
    local = entry.created_at.astimezone(tz)
    ip = None if entry.ip is None else str(entry.ip)
    net = "unknown" if ip is None else login_log.network_of(ip)
    key = f"ws:alert:{user.id}:{net}:{local.date().isoformat()}"
    # 去重键先于落库设置:之后 DB 写失败时本次提醒会被去重键吞掉,可接受(尽力而为)
    if not redis.set(key, "1", nx=True, ex=_ALERT_TTL):
        return
    reasons = "、".join(_REASON_TEXT.get(r, r) for r in entry.suspicious)
    when, where = local.strftime("%Y-%m-%d %H:%M"), ip or "未知网络"
    admins = db.scalars(
        select(User.id)
        .join(RoleBinding, RoleBinding.user_id == User.id)
        .where(
            User.school_id == user.school_id,
            User.status == "active",
            RoleBinding.role_type == Role.it_admin.value,
            RoleBinding.ended_at.is_(None),
        )
        .distinct()
    ).all()
    to_self = (
        f"你的账号于 {when} 从 {where} 登录({reasons})。"
        "如果不是你本人操作,请立即修改密码并联系信息中心。"
    )
    to_admin = f"{user.display_name}({user.login_name})于 {when} 从 {where} 登录({reasons})。"
    others = [uid for uid in admins if uid != user.id]
    plan = [(to_self, [user.id])] + ([(to_admin, others)] if others else [])
    events: list[tuple[list[UUID], dict]] = []
    for content, recipients in plan:
        notice = Notice(
            school_id=user.school_id,
            from_user_id=None,
            title="账号安全提醒",
            content=content,
            target={"type": "system", "kind": "security"},
            target_label="系统",
            require_ack=False,
            created_at=entry.created_at,
        )
        db.add(notice)
        db.flush()
        db.add_all(NoticeRecipient(notice_id=notice.id, user_id=uid) for uid in recipients)
        events.append(
            (
                recipients,
                {
                    "type": "notice.new",
                    "id": str(notice.id),
                    "title": notice.title,
                    "from_name": None,
                    "created_at": notice.created_at.isoformat(),
                },
            )
        )
    db.commit()
    for recipients, event in events:
        publish(redis, recipients, event)


def _finish_login(
    db: Session, redis: Redis, settings: Settings, user: User, request: Request | None
) -> LoginResult:
    """登录的最后一步(无两步验证的登录与通过第二步的登录共用):清失败计数、写时间、签发令牌。"""
    redis.delete(_fail_key(settings, user.login_name))
    user.last_login_at = clock.utc_now()
    db.commit()
    entry = _log(db, settings, user, user.login_name, "success", request)
    try:
        if entry is not None:
            alert(db, redis, user, entry)
    except Exception as exc:  # 提醒是尽力而为,不能挡住登录
        db.rollback()
        log.warning("login.alert_failed", error=type(exc).__name__)
    access_token, expires_at = issue_access_token(user.id, settings)
    refresh_token = sessions.issue_refresh(redis, settings, user.id)
    return LoginResult(access_token, refresh_token, expires_at, user)


def login(
    db: Session,
    redis: Redis,
    settings: Settings,
    login_name: str,
    password: str,
    request: Request | None = None,
) -> LoginResult | MfaChallengeResult:
    login_name = login_name.strip()
    try:
        fail_key = _check_not_locked(redis, settings, login_name, "登录失败次数过多,请稍后再试")
    except ApiError:
        known = get_user_by_login(db, settings.school_id, login_name)
        _log(db, settings, known, login_name, "locked", request)
        raise

    user = get_user_by_login(db, settings.school_id, login_name)
    hashed = user.password_hash if user is not None and user.status == "active" else _DUMMY_HASH
    password_ok = verify_password(password, hashed)
    if user is None or user.status != "active" or not password_ok:
        _record_failure(redis, settings, fail_key)
        outcome = (
            "unknown_user"
            if user is None
            else "inactive"
            if user.status != "active"
            else "bad_password"
        )
        _log(db, settings, user, login_name, outcome, request)
        raise ApiError(401, "INVALID_CREDENTIALS", "登录名或密码不正确")

    if user.totp_enabled_at is not None:
        # 只发一次性的 mfa_token:不签发任何令牌、不写 last_login_at;
        # 也不清失败计数,否则拿着密码的人可以靠反复第一步重置计数来无限试验证码
        token = mfa.issue_challenge(redis, user.id)
        return MfaChallengeResult(token, mfa.CHALLENGE_TTL)
    return _finish_login(db, redis, settings, user, request)


def _mfa_expired() -> ApiError:
    return ApiError(401, "MFA_EXPIRED", "验证已过期,请重新登录")


def login_totp(
    db: Session,
    redis: Redis,
    settings: Settings,
    mfa_token: str,
    code: str,
    request: Request | None = None,
) -> LoginResult:
    user_id = mfa.peek(redis, mfa_token)
    user = get_user(db, user_id) if user_id is not None else None
    if user is None or user.status != "active" or user.totp_enabled_at is None:
        # 账号在两步之间被冻结 / 归档 / 被重置了两步验证:挑战作废,从头来
        redis.delete(f"ws:mfa:{mfa_token}")
        if user is not None and user.status != "active":
            _log(db, settings, user, user.login_name, "inactive", request)
        raise _mfa_expired()
    # 锁定按登录名算:换一个 mfa_token 也一样被拒
    try:
        fail_key = _check_not_locked(
            redis, settings, user.login_name, "登录失败次数过多,请稍后再试"
        )
    except ApiError:
        _log(db, settings, user, user.login_name, "locked", request)
        raise
    secret = _load_secret(settings, user)
    if not totp.verify(redis, user.id, secret, code, clock.utc_now()):
        _record_failure(redis, settings, fail_key)
        mfa.record_try(redis, mfa_token)
        _log(db, settings, user, user.login_name, "totp_failed", request)
        raise ApiError(401, "TOTP_INVALID", "验证码不正确或已过期,请检查手机时间")
    if mfa.consume(redis, mfa_token) != user.id:  # 并发的另一个请求已经用掉
        raise _mfa_expired()
    return _finish_login(db, redis, settings, user, request)


def _aad(user_id: UUID) -> str:
    return f"totp:{user_id}"


def _load_secret(settings: Settings, user: User) -> str:
    """只认 v2: 前缀的密文;解不开、或解出来不是合法 base32,都按"无法读取"处理。"""
    unreadable = ApiError(500, "TOTP_UNREADABLE", "两步验证密钥无法读取,请联系信息中心重置")
    if user.totp_secret is None or not user.totp_secret.startswith("v2:"):
        raise unreadable
    try:
        secret = decrypt(user.totp_secret, settings.master_key_bytes, aad=_aad(user.id))
        base64.b32decode(secret, casefold=True)
    except (CryptoError, binascii.Error, ValueError):
        raise unreadable from None
    return secret


@dataclass
class TotpStatus:
    allowed: bool
    enabled: bool
    enabled_at: datetime | None


def totp_status(db: Session, user: User, settings: Settings) -> TotpStatus:
    return TotpStatus(
        allowed=get_security(db, settings.school_id).totp_allowed,
        enabled=user.totp_enabled_at is not None,
        enabled_at=user.totp_enabled_at,
    )


def _pending_key(user_id: UUID) -> str:
    return f"ws:totp:pending:{user_id}"


_PENDING_TTL = 600


def _require_allowed(db: Session, settings: Settings) -> None:
    if not get_security(db, settings.school_id).totp_allowed:
        raise ApiError(409, "TOTP_NOT_ALLOWED", "学校未开放两步验证")


def totp_setup(db: Session, redis: Redis, settings: Settings, user: User) -> tuple[str, str, str]:
    _require_allowed(db, settings)
    if user.totp_enabled_at is not None:
        raise ApiError(409, "TOTP_ALREADY_ENABLED", "已开启两步验证")
    secret = totp.new_secret()
    redis.set(_pending_key(user.id), secret, ex=_PENDING_TTL)
    school = db.get(School, settings.school_id)
    uri, svg = totp.provisioning(
        secret, issuer=school.name if school is not None else "workstation", account=user.login_name
    )
    return secret, uri, svg


def totp_enable(
    db: Session,
    redis: Redis,
    settings: Settings,
    user: User,
    password: str,
    code: str,
    keep_token: str,
    request: Request | None = None,
) -> None:
    # 顺序固定:先查失败上限,再验密码(错则计数),最后验验证码;密码不能代替验证码
    fail_key = _check_not_locked(redis, settings, user.login_name, "尝试次数过多,请稍后再试")
    if not verify_password(password, user.password_hash):
        _record_failure(redis, settings, fail_key)
        raise ApiError(400, "WRONG_PASSWORD", "密码不正确")
    _require_allowed(db, settings)
    if user.totp_enabled_at is not None:
        raise ApiError(409, "TOTP_ALREADY_ENABLED", "已开启两步验证")
    secret = redis.get(_pending_key(user.id))
    if secret is None:
        raise ApiError(409, "TOTP_SETUP_EXPIRED", "设置已过期,请重新开始")
    if not totp.verify(redis, user.id, secret, code, clock.utc_now()):
        raise ApiError(400, "TOTP_INVALID", "验证码不正确或已过期,请检查手机时间")
    user.totp_secret = encrypt(secret, settings.master_key_bytes, aad=_aad(user.id))
    user.totp_enabled_at = clock.utc_now()
    record(
        db,
        user_id=user.id,
        action="account.totp_enable",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
    )
    db.commit()
    redis.delete(fail_key)
    redis.delete(_pending_key(user.id))
    sessions.revoke_all(redis, user.id, keep=keep_token)
    publish(
        redis, [user.id], {"type": STALE}
    )  # 尽力而为,失败不影响开启;其他会话的实时连接随之重连并被拒(L149)


def totp_disable(
    db: Session,
    redis: Redis,
    settings: Settings,
    user: User,
    password: str,
    request: Request | None = None,
) -> None:
    fail_key = _check_not_locked(redis, settings, user.login_name, "尝试次数过多,请稍后再试")
    if not verify_password(password, user.password_hash):
        _record_failure(redis, settings, fail_key)
        raise ApiError(400, "WRONG_PASSWORD", "密码不正确")
    if user.totp_enabled_at is None:
        return
    user.totp_secret = None
    user.totp_enabled_at = None
    user.token_floor_at = clock.utc_now()  # 开启前签发的旧令牌不能因 totp_enabled_at 清空而复活
    record(
        db,
        user_id=user.id,
        action="account.totp_disable",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
    )
    db.commit()
    redis.delete(fail_key)


def refresh(
    db: Session, redis: Redis, settings: Settings, refresh_token: str
) -> tuple[str, datetime]:
    key = sessions.refresh_key(refresh_token)
    user_id = redis.get(key)
    user = None
    if user_id is not None:
        try:
            user = get_user(db, UUID(user_id))
        except ValueError:
            user = None
    if user is None or user.status != "active":
        sessions.revoke_refresh(redis, refresh_token)
        raise ApiError(401, "INVALID_REFRESH", "登录已失效,请重新登录")
    return issue_access_token(user.id, settings)


def logout(redis: Redis, refresh_token: str) -> None:
    sessions.revoke_refresh(redis, refresh_token)


def change_password(
    db: Session,
    redis: Redis,
    settings: Settings,
    user: User,
    old: str,
    new: str,
    keep_token: str,
    request: Request | None = None,
) -> None:
    # 与登录共用失败计数:已登录的人也不能无限次试旧密码
    fail_key = _fail_key(settings, user.login_name)
    if int(redis.get(fail_key) or 0) >= settings.login_max_failures:
        raise ApiError(
            429,
            "ACCOUNT_LOCKED",
            "尝试次数过多,请稍后再试",
            headers=_retry_after(redis, settings, fail_key),
        )
    if not verify_password(old, user.password_hash):
        _record_failure(redis, settings, fail_key)
        raise ApiError(400, "WRONG_PASSWORD", "旧密码不正确")
    check_policy(new, old=old, min_length=get_security(db, user.school_id).password_min_length)
    user.password_hash = hash_password(new)
    user.must_change_password = False
    user.password_changed_at = clock.utc_now()
    record(
        db,
        user_id=user.id,
        action="account.password_change",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
    )
    db.commit()
    redis.delete(fail_key)
    sessions.revoke_all(redis, user.id, keep=keep_token)
    publish(redis, [user.id], {"type": STALE})  # 尽力而为,失败不影响改密码
