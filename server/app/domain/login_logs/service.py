import csv
import io
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import clock
from app.domain.schools.service import local_day_start_utc, school_tz
from app.errors import ApiError
from app.models import LoginLog, User

PAGE_SIZE = 50
CSV_MAX_ROWS = 10000
DEFAULT_DAYS = 7
MAX_SPAN_DAYS = 92
MIN_DATE, MAX_DATE = date(1970, 1, 1), date(2100, 12, 31)  # 范围外的日期换算时区会溢出
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

ResultName = Literal["success", "bad_password", "unknown_user", "inactive", "locked", "totp_failed"]
RESULT_LABELS = {
    "success": "成功",
    "bad_password": "密码错误",
    "unknown_user": "账号不存在",
    "inactive": "账号已停用",
    "locked": "已锁定",
    "totp_failed": "验证码错误",
}
REASON_LABELS = {"night": "凌晨时段", "new_network": "新的网络环境"}


class LoginLogUser(BaseModel):
    id: str
    display_name: str


class LoginLogRow(BaseModel):
    id: str
    at: str
    login_name: str
    user: LoginLogUser | None
    result: str
    ip: str | None
    user_agent: str | None
    suspicious: list[str]


class LoginLogPage(BaseModel):
    items: list[LoginLogRow]
    total: int
    page: int
    page_size: int


@dataclass
class Filters:
    date_from: date | None = None
    date_to: date | None = None
    q: str | None = None
    results: list[str] | None = None
    suspicious: bool = False


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _query(db: Session, school_id: UUID, f: Filters):
    tz = school_tz(db, school_id)
    today = clock.utc_now().astimezone(tz).date()
    end = f.date_to or today
    start = f.date_from or end - timedelta(days=DEFAULT_DAYS - 1)
    for d in (start, end):
        if not MIN_DATE <= d <= MAX_DATE:
            raise ApiError(400, "BAD_REQUEST", "日期超出范围")
    if start > end:
        raise ApiError(400, "BAD_REQUEST", "开始日期不能晚于结束日期")
    if (end - start).days + 1 > MAX_SPAN_DAYS:
        raise ApiError(400, "BAD_REQUEST", f"查询跨度不能超过 {MAX_SPAN_DAYS} 天")
    stmt = (
        select(LoginLog, User.display_name)
        .outerjoin(User, (User.id == LoginLog.user_id) & (User.school_id == school_id))
        .where(
            LoginLog.school_id == school_id,
            LoginLog.created_at >= local_day_start_utc(start, tz),
            LoginLog.created_at < local_day_start_utc(end + timedelta(days=1), tz),
        )
    )
    if f.q and f.q.strip():
        like = f"%{_escape_like(f.q.strip())}%"
        stmt = stmt.where(
            or_(
                LoginLog.login_name.ilike(like, escape="\\"),
                User.display_name.ilike(like, escape="\\"),
            )
        )
    if f.results:
        stmt = stmt.where(LoginLog.result.in_(f.results))
    if f.suspicious:
        stmt = stmt.where(func.cardinality(LoginLog.suspicious) > 0)
    return stmt.order_by(LoginLog.created_at.desc(), LoginLog.id.desc()), tz


def _row(log: LoginLog, name: str | None) -> LoginLogRow:
    return LoginLogRow(
        id=str(log.id),
        at=log.created_at.isoformat(),
        login_name=log.login_name,
        user=None
        if log.user_id is None or name is None
        else LoginLogUser(id=str(log.user_id), display_name=name),
        result=log.result,
        ip=None if log.ip is None else str(log.ip),
        user_agent=log.user_agent,
        suspicious=list(log.suspicious or []),
    )


def query(db: Session, school_id: UUID, f: Filters, page: int) -> LoginLogPage:
    stmt, _tz = _query(db, school_id, f)
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = db.execute(stmt.limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE)).all()
    return LoginLogPage(
        items=[_row(log, name) for log, name in rows],
        total=total,
        page=page,
        page_size=PAGE_SIZE,
    )


def _cell(value: object) -> str:
    """表格软件会把 = + - @ 开头的文本当公式执行,加前缀转义(登录名是用户输入)。"""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_PREFIXES) else text


def export_csv(db: Session, school_id: UUID, f: Filters) -> tuple[str, int]:
    stmt, tz = _query(db, school_id, f)
    rows = db.execute(stmt.limit(CSV_MAX_ROWS)).all()
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(["时间", "登录名", "姓名", "结果", "IP", "设备", "可疑原因"])
    for log, name in rows:
        writer.writerow(
            [
                log.created_at.astimezone(tz).strftime("%Y-%m-%d %H:%M:%S"),
                _cell(log.login_name),
                _cell(name),
                RESULT_LABELS.get(log.result, log.result),
                "" if log.ip is None else str(log.ip),
                _cell(log.user_agent),
                "、".join(REASON_LABELS.get(r, r) for r in log.suspicious or []),
            ]
        )
    return "﻿" + out.getvalue(), len(rows)
