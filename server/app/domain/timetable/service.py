from collections.abc import Sequence
from datetime import UTC, datetime, time
from uuid import UUID

from fastapi import Request
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.audit.service import record
from app.domain.exams.subjects import class_subjects
from app.domain.schools.service import active_academic_year, school_tz
from app.domain.timetable.schemas import (
    CellInput,
    ClassTimetable,
    Period,
    TeacherBrief,
    TimetableCell,
)
from app.errors import ApiError
from app.models import AcademicYear, School, SchoolClass
from app.models.timetable import Period as PeriodRow
from app.models.timetable import TimetableEntry

SOON_MINUTES = 5


def _hhmm(t: time) -> str:
    return t.strftime("%H:%M")


def _parse(value: str) -> time:
    hour, minute = value.split(":")
    return time(int(hour), int(minute))


def list_periods(db: Session, school_id: UUID) -> list[Period]:
    rows = db.scalars(
        select(PeriodRow).where(PeriodRow.school_id == school_id).order_by(PeriodRow.no)
    )
    return [Period(no=r.no, starts_at=_hhmm(r.starts_at), ends_at=_hhmm(r.ends_at)) for r in rows]


def lock_school(db: Session, school_id: UUID) -> None:
    """作息与课表共用这一把锁(L156):删节次(save_periods)与写课表(save_class_timetable)串行,
    写课表时读到的"已设节次"在它提交前不会被另一边删掉,不会留下引用已删节次的格子。
    加锁顺序固定:先 School 行,再班级行。"""
    db.execute(select(School.id).where(School.id == school_id).with_for_update())


def save_periods(
    db: Session,
    school_id: UUID,
    periods: Sequence[Period],
    actor: UUID,
    request: Request | None,
) -> list[Period]:
    lock_school(db, school_id)
    keep = {p.no for p in periods}
    in_use = db.execute(
        select(SchoolClass.name, TimetableEntry.period_no)
        .join(TimetableEntry, TimetableEntry.class_id == SchoolClass.id)
        .where(SchoolClass.school_id == school_id, TimetableEntry.period_no.not_in(keep))
        .distinct()
        .order_by(SchoolClass.name, TimetableEntry.period_no)
    ).all()
    if in_use:
        names = sorted({name for name, _ in in_use})
        nos = sorted({no for _, no in in_use})
        raise ApiError(
            409,
            "PERIOD_IN_USE",
            f"节次已被课表使用,不能删除。涉及班级:{'、'.join(names)}",
            {"classes": names, "periods": nos},
        )
    db.execute(delete(PeriodRow).where(PeriodRow.school_id == school_id))
    db.flush()
    for p in sorted(periods, key=lambda x: x.no):
        db.add(
            PeriodRow(
                school_id=school_id,
                no=p.no,
                starts_at=_parse(p.starts_at),
                ends_at=_parse(p.ends_at),
            )
        )
    record(
        db,
        user_id=actor,
        action="periods.update",
        success=True,
        object_type="school",
        object_id=str(school_id),
        request=request,
        extra={"count": len(periods)},
    )
    db.commit()
    return list_periods(db, school_id)


# ---------- 任课老师 ----------


def _assignments(db: Session, class_id: UUID, year_id: UUID) -> list[tuple[UUID, str, str | None]]:
    """该班当前学年在任的班主任 / 任课老师:(teacher_id, identity, subject)。"""
    rows = db.execute(
        text(
            "SELECT teacher_id, identity, subject FROM teacher_assignments"
            " WHERE class_id = :c AND academic_year_id = :y AND ended_at IS NULL"
            " AND identity IN ('homeroom', 'subject')"
        ),
        {"c": class_id, "y": year_id},
    ).all()
    return [(r[0], r[1], r[2]) for r in rows]


def auto_teacher(db: Session, cls: SchoolClass, year: AcademicYear, subject: str) -> UUID | None:
    return _auto(_assignments(db, cls.id, year.id), subject)


def _auto(assignments: Sequence[tuple[UUID, str, str | None]], subject: str) -> UUID | None:
    matches = {tid for tid, _, subj in assignments if subj == subject}
    return next(iter(matches)) if len(matches) == 1 else None


def _may_teach(
    assignments: Sequence[tuple[UUID, str, str | None]], tid: UUID, subject: str
) -> bool:
    # 班主任登记了任教科目时按科目算;没登记科目的班主任可排任何科目
    return any(
        t == tid and (subj == subject or (ident == "homeroom" and not subj))
        for t, ident, subj in assignments
    )


def teacher_names(db: Session, ids: Sequence[UUID]) -> dict[UUID, str]:
    if not ids:
        return {}
    rows = db.execute(
        text(
            "SELECT t.id, u.display_name FROM teachers t JOIN users u ON u.id = t.user_id"
            " WHERE t.id = ANY(:ids)"
        ),
        {"ids": list(ids)},
    ).all()
    return {r[0]: r[1] for r in rows}


def _cells_out(db: Session, entries: Sequence[TimetableEntry]) -> list[TimetableCell]:
    names = teacher_names(db, [e.teacher_id for e in entries if e.teacher_id])
    out = []
    for e in sorted(entries, key=lambda e: (e.weekday, e.period_no)):
        teacher = None
        if e.teacher_id is not None and e.teacher_id in names:
            teacher = TeacherBrief(id=e.teacher_id, name=names[e.teacher_id])
        out.append(
            TimetableCell(
                weekday=e.weekday, period_no=e.period_no, subject=e.subject, teacher=teacher
            )
        )
    return out


def class_timetable(db: Session, cls: SchoolClass, year: AcademicYear) -> ClassTimetable:
    entries = db.scalars(
        select(TimetableEntry).where(
            TimetableEntry.class_id == cls.id, TimetableEntry.academic_year_id == year.id
        )
    ).all()
    return ClassTimetable(class_id=cls.id, class_name=cls.name, cells=_cells_out(db, entries))


def defined_period_nos(db: Session, school_id: UUID) -> set[int]:
    return set(db.scalars(select(PeriodRow.no).where(PeriodRow.school_id == school_id)))


def resolve_cell_teacher(
    assignments: Sequence[tuple[UUID, str, str | None]], cell: CellInput
) -> UUID | None:
    """显式 teacher_id 必须是该班该科在任的任课老师或班主任;省略时唯一匹配才填。"""
    if cell.teacher_id is None:
        return _auto(assignments, cell.subject)
    if not _may_teach(assignments, cell.teacher_id, cell.subject):
        raise ApiError(400, "BAD_REQUEST", "该老师不是本班本科目在任的任课老师或班主任")
    return cell.teacher_id


def lock_class(db: Session, class_id: UUID) -> SchoolClass:
    cls = db.scalars(
        select(SchoolClass)
        .where(SchoolClass.id == class_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one()
    return cls


def replace_entries(
    db: Session, cls: SchoolClass, year: AcademicYear, rows: Sequence[tuple[CellInput, UUID | None]]
) -> None:
    db.execute(
        delete(TimetableEntry).where(
            TimetableEntry.class_id == cls.id, TimetableEntry.academic_year_id == year.id
        )
    )
    db.flush()
    for cell, tid in rows:
        db.add(
            TimetableEntry(
                class_id=cls.id,
                academic_year_id=year.id,
                weekday=cell.weekday,
                period_no=cell.period_no,
                subject=cell.subject,
                teacher_id=tid,
            )
        )
    db.flush()


def save_class_timetable(
    db: Session,
    cls: SchoolClass,
    year: AcademicYear,
    cells: Sequence[CellInput],
    actor: UUID,
    request: Request | None,
) -> ClassTimetable:
    if cls.academic_year_id != year.id:
        raise ApiError(400, "BAD_REQUEST", "只能修改当前学年班级的课表")
    lock_school(db, cls.school_id)  # 先 School 再班级(与 save_periods 同一把锁,L156)
    cls = lock_class(db, cls.id)
    periods = defined_period_nos(db, cls.school_id)
    assignments = _assignments(db, cls.id, year.id)
    # 可排的科目 = 本班科目(考试科目表 / 目录)∪ 本班在任老师登记的任教科目(L210):
    # 组织架构里有"信息技术"老师、考试科目表没有这门课,也该能排进课表
    subjects = {s.name for s in class_subjects(db, cls)} | {
        subj for _, _, subj in assignments if subj
    }
    seen: set[tuple[int, int]] = set()
    for c in cells:
        if c.period_no not in periods:
            raise ApiError(400, "BAD_REQUEST", f"第 {c.period_no} 节尚未在作息时间中设置")
        if c.subject not in subjects:
            raise ApiError(400, "BAD_REQUEST", f"「{c.subject}」不是本班科目,也没有在任老师任教它")
        if (c.weekday, c.period_no) in seen:
            raise ApiError(400, "BAD_REQUEST", "同一星期同一节次不能重复安排")
        seen.add((c.weekday, c.period_no))
    resolved = [(c, resolve_cell_teacher(assignments, c)) for c in cells]
    replace_entries(db, cls, year, resolved)
    record(
        db,
        user_id=actor,
        action="timetable.update",
        success=True,
        object_type="class",
        object_id=str(cls.id),
        request=request,
        extra={"cells": len(cells)},
    )
    db.commit()
    return class_timetable(db, cls, year)


# ---------- 当前时段 ----------


def current_slot(db: Session, school_id: UUID, now: datetime) -> tuple[int, int, time] | None:
    """学校时区下 now 所在(或 5 分钟内将开始)的节次:(weekday, period_no, ends_at)。

    当前学年当天没有任何课表格子(如周日)或没有作息时,返回 None;结束时刻含当分钟。
    """
    year = active_academic_year(db, school_id)
    if year is None:
        return None
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    local = now.astimezone(school_tz(db, school_id))
    weekday = local.isoweekday()
    has_cells = db.scalar(
        select(TimetableEntry.id)
        .join(SchoolClass, SchoolClass.id == TimetableEntry.class_id)
        .where(
            SchoolClass.school_id == school_id,
            TimetableEntry.academic_year_id == year.id,
            TimetableEntry.weekday == weekday,
        )
        .limit(1)
    )
    if has_cells is None:
        return None
    minute = local.hour * 60 + local.minute
    rows = db.scalars(
        select(PeriodRow).where(PeriodRow.school_id == school_id).order_by(PeriodRow.no)
    ).all()

    def mins(t: time) -> int:
        return t.hour * 60 + t.minute

    for p in rows:
        if mins(p.starts_at) <= minute <= mins(p.ends_at):
            return weekday, p.no, p.ends_at
    for p in rows:
        if mins(p.starts_at) - SOON_MINUTES <= minute < mins(p.starts_at):
            return weekday, p.no, p.ends_at
    return None


def teaches_now(
    db: Session, teacher_id: UUID, class_id: UUID, year_id: UUID, now: datetime
) -> TimetableCell | None:
    """该老师此刻是否在该班上课:当前学年的课表格子,且任职未结束。"""
    cls = db.get(SchoolClass, class_id)
    if cls is None:
        return None
    year = active_academic_year(db, cls.school_id)
    if year is None or year.id != year_id or cls.academic_year_id != year_id:
        return None
    slot = current_slot(db, cls.school_id, now)
    if slot is None:
        return None
    weekday, period_no, _ = slot
    entry = db.scalars(
        select(TimetableEntry).where(
            TimetableEntry.class_id == class_id,
            TimetableEntry.academic_year_id == year_id,
            TimetableEntry.weekday == weekday,
            TimetableEntry.period_no == period_no,
            TimetableEntry.teacher_id == teacher_id,
        )
    ).first()
    if entry is None:
        return None
    active = db.scalar(
        text(
            "SELECT 1 FROM teacher_assignments WHERE teacher_id = :t AND class_id = :c"
            " AND academic_year_id = :y AND ended_at IS NULL"
            " AND identity IN ('homeroom', 'subject') LIMIT 1"
        ),
        {"t": teacher_id, "c": class_id, "y": year_id},
    )
    if active is None:
        return None
    return _cells_out(db, [entry])[0]
