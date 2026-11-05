"""首次安装:初始化学校与信息中心管理员。"""

import re
from typing import Literal

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit.service import record
from app.auth.passwords import check_policy, hash_password
from app.config import Settings
from app.errors import ApiError
from app.models import RoleBinding, School, User
from app.rbac.roles import Role

InitResult = Literal["created", "exists"]

LOGIN_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
ADMIN_DISPLAY_NAME = "信息中心管理员"


class InitError(ValueError):
    """参数不合法;消息为中文且不含密码。"""


def _validate(name: str, admin_login: str, admin_password: str) -> None:
    if not 1 <= len(name) <= 50 or name != name.strip():
        raise InitError("校名需为 1–50 个字,且首尾不能有空白")
    if not LOGIN_RE.fullmatch(admin_login):
        raise InitError("管理员登录名需为 3–32 位字母、数字或 . _ -")
    try:
        check_policy(admin_password)
    except ApiError as exc:
        raise InitError(f"管理员密码不符合要求:{exc.message}") from None


def init_school(
    db: Session, settings: Settings, *, name: str, admin_login: str, admin_password: str
) -> InitResult:
    school_id = settings.school_id
    if db.get(School, school_id) is not None:
        return "exists"
    _validate(name, admin_login, admin_password)
    try:
        db.add(School(id=school_id, name=name))
        db.flush()
        user = User(
            school_id=school_id,
            login_name=admin_login,
            password_hash=hash_password(admin_password),
            display_name=ADMIN_DISPLAY_NAME,
            must_change_password=True,
        )
        db.add(user)
        db.flush()
        db.execute(
            text("INSERT INTO teachers (user_id, subjects) VALUES (:u, '{}')"), {"u": user.id}
        )
        db.add(
            RoleBinding(
                user_id=user.id,
                role_type=Role.it_admin.value,
                scope={"school_id": str(school_id)},
                academic_year_id=None,
            )
        )
        db.flush()
        record(
            db,
            user_id=None,
            action="system.init",
            success=True,
            object_type="school",
            object_id=str(school_id),
            extra={"school_name": name, "admin_login": admin_login, "via": "cli"},
        )
        db.commit()
    except IntegrityError:
        # 并发安装的输家:赢家已提交,按"已初始化过"处理
        db.rollback()
        if db.get(School, school_id) is not None:
            return "exists"
        raise
    except Exception:
        db.rollback()
        raise
    return "created"
