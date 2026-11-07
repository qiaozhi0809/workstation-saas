import csv
import io
from datetime import datetime
from uuid import UUID

from fastapi import Request
from sqlalchemy import exists, func, select, update
from sqlalchemy.orm import Session

from app.audit.service import record
from app.domain.classes.sort import class_sort_key
from app.domain.notices.schemas import AckInput, AckRow, AckStats
from app.domain.notices.service import _own_notice, ack_spec, without_parent_of
from app.domain.schools.service import school_tz
from app.errors import ApiError
from app.models import (
    Notice,
    NoticeRecipient,
    NoticeStudent,
    Parent,
    ParentLink,
    Student,
    User,
)

NOTE_MAX = 200
BOM = "﻿"
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _my_link_in_use(db: Session, user: User, notice_id: UUID) -> bool:
    """家长对象:这条通知涉及的自己孩子里,至少一个绑定仍在用**且是主家长**
    (与收件箱 ack_block_reason = not_primary 同口径:发送后被改成次要家长的不能再回执)。
    显式查 notice_students ⋈ parent_links ⋈ parents(user_id = 我);不复用 child_link_or_deny
    (它写的是 parent.view 审计,只管单个学生)。"""
    return bool(
        db.scalar(
            select(
                exists().where(
                    NoticeStudent.notice_id == notice_id,
                    NoticeStudent.parent_user_id == user.id,
                    ParentLink.student_id == NoticeStudent.student_id,
                    ParentLink.status == "active",
                    ParentLink.is_primary.is_(True),
                    ParentLink.parent_id == Parent.id,
                    Parent.user_id == user.id,
                )
            )
        )
    )


def _clean_note(note: str | None) -> str | None:
    if note is None:
        return None
    note = note.strip()
    return note or None


def _validate(notice: Notice, body: AckInput) -> tuple[int | None, str | None]:
    note = _clean_note(body.note)
    if notice.ack_kind == "confirm":
        if body.choice is not None or note is not None:
            raise ApiError(400, "ACK_INVALID", "该回执只需点“已知晓”")
        return None, None
    options = notice.ack_options or []
    if body.choice is None or not 0 <= body.choice < len(options):
        raise ApiError(400, "ACK_INVALID", "请选择一个有效的选项")
    if note is not None and (not notice.ack_allow_note or len(note) > NOTE_MAX):
        raise ApiError(400, "ACK_INVALID", "留言不符合要求")
    return body.choice, note


def submit_ack(
    db: Session,
    user: User,
    notice_id: UUID,
    body: AckInput,
    *,
    now: datetime,
    request: Request | None = None,
) -> None:
    """只有收件人(notice_recipients.user_id = 我)能回执,否则 404。"""
    row = db.execute(
        select(Notice)
        .join(NoticeRecipient, NoticeRecipient.notice_id == Notice.id)
        .where(Notice.id == notice_id, NoticeRecipient.user_id == user.id)
    ).scalar_one_or_none()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "通知不存在")
    notice = row
    if notice.ack_kind == "none":
        raise ApiError(409, "ACK_NOT_REQUIRED", "这条通知不需要回执")
    if notice.recalled_at is not None:
        raise ApiError(409, "NOTICE_RECALLED", "通知已撤回")
    if notice.ack_deadline is not None and now >= notice.ack_deadline:
        raise ApiError(409, "ACK_CLOSED", "回执已截止")
    if notice.audience == "parents" and not _my_link_in_use(db, user, notice.id):
        record(
            db,
            user_id=user.id,
            action="notice.ack",
            success=False,
            object_type="notice",
            object_id=str(notice.id),
            request=request,
        )
        db.commit()
        raise ApiError(403, "ACK_NOT_ALLOWED", "与孩子的关联已不是在用的主家长绑定,不能回执")
    choice, note = _validate(notice, body)
    db.execute(
        update(NoticeRecipient)
        .where(NoticeRecipient.notice_id == notice.id, NoticeRecipient.user_id == user.id)
        .values(
            ack_choice=choice,
            ack_content=note,
            acked_at=now,
            read_at=func.coalesce(NoticeRecipient.read_at, now),
        )
    )
    record(
        db,
        user_id=user.id,
        action="notice.ack",
        success=True,
        object_type="notice",
        object_id=str(notice.id),
        request=request,
        extra={"kind": notice.ack_kind},
    )
    db.commit()


def _rows(db: Session, notice: Notice) -> list[AckRow]:
    if notice.audience == "teachers":
        found = db.execute(
            select(NoticeRecipient, User.display_name)
            .join(User, User.id == NoticeRecipient.user_id)
            .where(NoticeRecipient.notice_id == notice.id)
            .order_by(User.display_name, User.id)
        ).all()
        return [
            AckRow(
                user_id=r.user_id,
                user_name=name,
                student_id=None,
                student_name=None,
                class_name=None,
                read_at=r.read_at,
                choice=r.ack_choice,
                note=r.ack_content,
                acked_at=r.acked_at,
            )
            for r, name in found
        ]
    # 班名读发送时刻的快照(notice_students.class_name,L87),学年升级 / 转班 / 删班都不改统计
    found = db.execute(
        select(NoticeStudent, NoticeRecipient, Student, User.display_name)
        .join(
            NoticeRecipient,
            (NoticeRecipient.notice_id == NoticeStudent.notice_id)
            & (NoticeRecipient.user_id == NoticeStudent.parent_user_id),
        )
        .join(Student, Student.id == NoticeStudent.student_id)
        .join(User, User.id == NoticeStudent.parent_user_id)
        .where(NoticeStudent.notice_id == notice.id)
    ).all()
    return [
        AckRow(
            user_id=ns.parent_user_id,
            user_name=parent_name,
            student_id=stu.id,
            student_name=stu.name,
            class_name=ns.class_name,
            read_at=r.read_at,
            choice=r.ack_choice,
            note=r.ack_content,
            acked_at=r.acked_at,
        )
        for ns, r, stu, parent_name in sorted(
            found,
            key=lambda x: (
                class_sort_key(x[0].class_name or ""),  # 班名数值序(L266)
                x[2].student_no or "~",
                x[2].mk,
                str(x[2].id),
            ),
        )
    ]


def ack_stats(db: Session, sender: User, notice_id: UUID) -> AckStats:
    """只认发送人本人(_own_notice),其余 404。parent 对象一学生一行,老师对象一收件人一行。"""
    notice = _own_notice(db, sender, notice_id)
    rows = _rows(db, notice)
    counts: list[int] = []
    if notice.ack_kind == "choice":
        counts = [0] * len(notice.ack_options or [])
        for r in rows:
            if r.acked_at is not None and r.choice is not None and 0 <= r.choice < len(counts):
                counts[r.choice] += 1
    return AckStats(
        audience=notice.audience,
        ack=ack_spec(notice),
        ack_deadline=notice.ack_deadline,
        total=len(rows),
        read=sum(1 for r in rows if r.read_at is not None),
        acked=sum(1 for r in rows if r.acked_at is not None),
        counts=counts,
        students_without_parent=without_parent_of(notice),
        rows=rows,
    )


def _cell(value: object) -> str:
    """表格软件会把 = + - @ 开头的文本当公式执行,加前缀转义(留言是用户输入)。"""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_PREFIXES) else text


def ack_csv(db: Session, sender: User, notice_id: UUID, request: Request | None = None) -> str:
    notice = _own_notice(db, sender, notice_id)
    rows = _rows(db, notice)
    tz = school_tz(db, notice.school_id)
    options = notice.ack_options or []

    def when(value: datetime | None) -> str:
        return value.astimezone(tz).strftime("%Y-%m-%d %H:%M") if value else ""

    def answer(r: AckRow) -> str:
        if r.acked_at is None:
            return ""
        if notice.ack_kind == "choice" and r.choice is not None and r.choice < len(options):
            return options[r.choice]
        return "已知晓" if notice.ack_kind == "confirm" else ""

    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    if notice.audience == "parents":
        writer.writerow(["班级", "学号", "学生", "家长", "已读时间", "回执", "留言", "回执时间"])
        numbers = dict(
            db.execute(
                select(Student.id, Student.student_no).where(
                    Student.id.in_([r.student_id for r in rows if r.student_id])
                )
            ).all()
        )
        for r in rows:
            writer.writerow(
                [
                    _cell(r.class_name),
                    _cell(numbers.get(r.student_id)),
                    _cell(r.student_name),
                    _cell(r.user_name),
                    when(r.read_at),
                    _cell(answer(r)),
                    _cell(r.note),
                    when(r.acked_at),
                ]
            )
    else:
        writer.writerow(["姓名", "已读时间", "回执", "留言", "回执时间"])
        for r in rows:
            writer.writerow(
                [
                    _cell(r.user_name),
                    when(r.read_at),
                    _cell(answer(r)),
                    _cell(r.note),
                    when(r.acked_at),
                ]
            )
    record(
        db,
        user_id=sender.id,
        action="notice.ack_export",
        success=True,
        object_type="notice",
        object_id=str(notice.id),
        request=request,
        extra={"rows": len(rows)},
    )
    db.commit()
    return BOM + out.getvalue()
