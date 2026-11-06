from fastapi import Request
from sqlalchemy.orm import Session

from app.audit.service import record
from app.errors import ApiError
from app.models import User


def reset_totp(db: Session, actor: User, user: User, request: Request | None) -> None:
    """信息中心清掉某人的两步验证(丢手机的兜底);不能对自己用。"""
    if actor.id == user.id:
        raise ApiError(409, "CANNOT_RESET_SELF", "不能重置自己的两步验证,请用关闭两步验证")
    user.totp_secret = None
    user.totp_enabled_at = None
    record(
        db,
        user_id=actor.id,
        action="account.totp_reset",
        success=True,
        object_type="user",
        object_id=str(user.id),
        request=request,
    )
    db.commit()
