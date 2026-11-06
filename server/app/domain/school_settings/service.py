from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit.service import record
from app.domain.school_settings.schemas import SecuritySettings, Switches, TagRename
from app.errors import ApiError
from app.models import SchoolSetting, Student

TAG_KEY = "tag_pool"
SWITCHES_KEY = "switches"
SECURITY_KEY = "security"

DEFAULT_TAGS: tuple[str, ...] = (
    "重点关注",
    "住校",
    "留守",
    "单亲",
    "近视",
    "过敏",
    "体育特长",
    "文艺特长",
    "进步明显",
    "偏科",
    "心理关注",
    "困难帮扶",
)
PROTECTED_TAGS: tuple[str, ...] = ("重点关注", "住校")

DEFAULT_SWITCHES = Switches(
    parent_rank=False,
    parent_negative_review=False,
    teacher_review_frequency=False,
    monitor=False,
    parent_monitor=False,
    ai_review_before_send=True,
    star_of_week=True,
    birthdays=True,
)

DEFAULT_SECURITY = SecuritySettings(
    totp_allowed=False, password_min_length=8, password_max_age_days=0
)


def _row(db: Session, school_id: UUID, key: str) -> SchoolSetting | None:
    return db.scalars(
        select(SchoolSetting).where(SchoolSetting.school_id == school_id, SchoolSetting.key == key)
    ).first()


def _upsert(db: Session, school_id: UUID, key: str, value: Any) -> SchoolSetting:
    row = _row(db, school_id, key)
    if row is None:
        row = SchoolSetting(school_id=school_id, key=key, value=value)
        db.add(row)
    else:
        row.value = value
    db.flush()
    return row


def get_tag_pool(db: Session, school_id: UUID) -> list[str]:
    row = _row(db, school_id, TAG_KEY)
    if row is None:
        return list(DEFAULT_TAGS)
    return list(row.value.get("tags", []))


def _apply_renames(db: Session, school_id: UUID, renames: list[TagRename]) -> None:
    mapping = {r.from_: r.to for r in renames if r.from_ != r.to}
    if not mapping:
        return
    students = db.scalars(
        select(Student).where(Student.school_id == school_id, Student.tags.overlap(list(mapping)))
    ).all()
    for student in students:
        seen: set[str] = set()
        merged: list[str] = []
        for tag in student.tags:
            tag = mapping.get(tag, tag)
            if tag not in seen:
                seen.add(tag)
                merged.append(tag)
        student.tags = merged


def save_tag_pool(
    db: Session,
    school_id: UUID,
    user_id: UUID,
    tags: list[str],
    renames: list[TagRename],
    request: Request | None = None,
) -> list[str]:
    """保存标签池,并先把改名同步到本校学生。

    - renames 的 from 不能是受保护标签,否则 400 TAG_PROTECTED;池里必须仍含受保护标签。
    - renames 的 to 不要求在新池里:契约未规定,服务端不校验,由前端保证改名目标在池内。
    - renames 按 from 建映射,同一个 from 重复出现时后一条覆盖前一条;每个学生只替换一遍
      (a→b 与 b→c 同时出现不会连环改成 c),保持原顺序,后出现的重复标签去掉。
    """
    if any(t not in tags for t in PROTECTED_TAGS) or any(
        r.from_ in PROTECTED_TAGS for r in renames
    ):
        raise ApiError(400, "TAG_PROTECTED", "「重点关注」「住校」是系统标签,不能删除或改名")
    _apply_renames(db, school_id, renames)
    row = _upsert(db, school_id, TAG_KEY, {"tags": tags})
    record(
        db,
        user_id=user_id,
        action="settings.tag_pool",
        success=True,
        object_type="school_setting",
        object_id=str(row.id),
        request=request,
        extra={"renames": [{"from": r.from_, "to": r.to} for r in renames]},
    )
    db.commit()
    return tags


def get_switches(db: Session, school_id: UUID) -> Switches:
    row = _row(db, school_id, SWITCHES_KEY)
    if row is None:
        return DEFAULT_SWITCHES
    return Switches(**{**DEFAULT_SWITCHES.model_dump(), **row.value})


def save_switches(
    db: Session,
    school_id: UUID,
    user_id: UUID,
    switches: Switches,
    request: Request | None = None,
) -> Switches:
    if switches.parent_monitor:
        raise ApiError(400, "BAD_REQUEST", "家长端暂不开放监控视频")
    row = _upsert(db, school_id, SWITCHES_KEY, switches.model_dump())
    record(
        db,
        user_id=user_id,
        action="settings.switches",
        success=True,
        object_type="school_setting",
        object_id=str(row.id),
        request=request,
    )
    db.commit()
    return switches


def get_security(db: Session, school_id: UUID) -> SecuritySettings:
    row = _row(db, school_id, SECURITY_KEY)
    if row is None:
        return DEFAULT_SECURITY
    return SecuritySettings(**{**DEFAULT_SECURITY.model_dump(), **row.value})


def save_security(
    db: Session,
    school_id: UUID,
    data: SecuritySettings,
    actor: UUID,
    request: Request | None = None,
) -> SecuritySettings:
    row = _upsert(db, school_id, SECURITY_KEY, data.model_dump())
    record(
        db,
        user_id=actor,
        action="settings.security_update",
        success=True,
        object_type="school_setting",
        object_id=str(row.id),
        request=request,
    )
    db.commit()
    return data
