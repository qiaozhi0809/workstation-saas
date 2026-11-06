import csv
import io
from collections.abc import Sequence
from uuid import UUID

from fastapi import Request
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.audit.service import record
from app.domain.exams.subjects import class_subjects
from app.domain.timetable import service
from app.domain.timetable.schemas import (
    CellInput,
    ImportLineError,
    TimetableImportResult,
    TimetableImportRow,
)
from app.errors import ApiError
from app.models import AcademicYear, SchoolClass

HEADERS = ("班级", "星期", "节次", "科目", "工号")
MAX_ROWS = 2000
_WEEKDAYS = {n: i for i, n in enumerate("一二三四五六日", start=1)}


def _bad_header() -> ApiError:
    return ApiError(400, "BAD_REQUEST", "表头应为:班级,星期,节次,科目,工号")


def _decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    try:
        return raw.decode("gbk")
    except UnicodeDecodeError:
        raise ApiError(400, "BAD_REQUEST", "文件编码无法识别,请使用 UTF-8 或 GBK") from None


def _weekday(value: str) -> int:
    value = value.strip()
    if value.isdigit() and 1 <= int(value) <= 7:
        return int(value)
    for prefix in ("星期", "周"):
        if value.startswith(prefix) and value[len(prefix) :] in _WEEKDAYS:
            return _WEEKDAYS[value[len(prefix) :]]
    return 0


def _period(value: str) -> int:
    value = value.strip()
    return int(value) if value.isdigit() and int(value) < 10_000 else 0


def parse_csv(raw: bytes) -> list[TimetableImportRow]:
    try:
        reader = csv.reader(io.StringIO(_decode(raw)))
        header = next(reader, None)
        if header is None or sorted(h.strip() for h in header) != sorted(HEADERS):
            raise _bad_header()
        names = [h.strip() for h in header]
        index = {name: names.index(name) for name in HEADERS}
        rows: list[TimetableImportRow] = []
        for line, cells in enumerate(reader, start=2):
            if not any(c.strip() for c in cells):
                continue

            def cell(name: str, cells: list[str] = cells) -> str:
                i = index[name]
                return cells[i].strip() if i < len(cells) else ""

            rows.append(
                TimetableImportRow(
                    line=line,
                    class_name=cell("班级"),
                    weekday=_weekday(cell("星期")),
                    period_no=_period(cell("节次")),
                    subject=cell("科目"),
                    employee_no=cell("工号") or None,
                )
            )
            if len(rows) > MAX_ROWS:
                raise ApiError(400, "BAD_REQUEST", f"一次最多导入 {MAX_ROWS} 行")
        return rows
    except csv.Error:
        raise ApiError(400, "BAD_REQUEST", "CSV 文件格式不对,无法读取") from None


def _teachers_by_employee_no(db: Session, school_id: UUID, nos: Sequence[str]) -> dict[str, UUID]:
    if not nos:
        return {}
    found = db.execute(
        text(
            "SELECT t.employee_no, t.id FROM teachers t JOIN users u ON u.id = t.user_id"
            " WHERE u.school_id = :s AND t.employee_no = ANY(:nos)"
        ),
        {"s": school_id, "nos": list(nos)},
    ).all()
    return {r[0]: r[1] for r in found}


def import_rows(
    db: Session,
    school_id: UUID,
    year: AcademicYear,
    rows: Sequence[TimetableImportRow],
    actor: UUID,
    request: Request | None,
) -> TimetableImportResult:
    classes = {
        c.name: c
        for c in db.scalars(
            select(SchoolClass).where(
                SchoolClass.school_id == school_id, SchoolClass.academic_year_id == year.id
            )
        )
    }
    periods = service.defined_period_nos(db, school_id)
    teacher_ids = _teachers_by_employee_no(
        db, school_id, sorted({r.employee_no for r in rows if r.employee_no})
    )
    subjects: dict[UUID, set[str]] = {}
    assignments: dict[UUID, list] = {}
    errors: list[ImportLineError] = []
    plan: dict[UUID, list[tuple[CellInput, UUID | None]]] = {}
    seen: set[tuple[UUID, int, int]] = set()

    def fail(line: int, message: str) -> None:
        errors.append(ImportLineError(line=line, message=message))

    for r in rows:
        cls = classes.get(r.class_name)
        if cls is None:
            fail(r.line, f"找不到班级「{r.class_name}」")
            continue
        if r.weekday == 0:
            fail(r.line, "星期不对,应为 1-7 或 周一至周日")
            continue
        if r.period_no == 0 or r.period_no not in periods:
            fail(r.line, f"第 {r.period_no} 节没有在作息时间中设置")
            continue
        if cls.id not in subjects:
            subjects[cls.id] = {s.name for s in class_subjects(db, cls)}
            assignments[cls.id] = service._assignments(db, cls.id, year.id)
        if r.subject not in subjects[cls.id]:
            fail(r.line, f"「{r.subject}」不是{cls.name}的科目")
            continue
        key = (cls.id, r.weekday, r.period_no)
        if key in seen:
            fail(r.line, "同一班级同一星期同一节次重复")
            continue
        seen.add(key)
        teacher_id: UUID | None = None
        if r.employee_no:
            teacher_id = teacher_ids.get(r.employee_no)
            if teacher_id is None:
                fail(r.line, f"工号「{r.employee_no}」不存在")
                continue
        try:
            cell = CellInput(
                weekday=r.weekday, period_no=r.period_no, subject=r.subject, teacher_id=teacher_id
            )
            resolved = service.resolve_cell_teacher(assignments[cls.id], cell)
        except ApiError as exc:
            fail(r.line, exc.message)
            continue
        except ValueError:
            fail(r.line, "科目不能为空或超过 20 个字")
            continue
        plan.setdefault(cls.id, []).append((cell, resolved))

    if errors:
        errors.sort(key=lambda e: e.line)
        return TimetableImportResult(ok=False, written=0, errors=errors)

    written = 0
    for class_id in sorted(plan):
        cls = service.lock_class(db, class_id)
        service.replace_entries(db, cls, year, plan[class_id])
        written += len(plan[class_id])
    record(
        db,
        user_id=actor,
        action="timetable.import",
        success=True,
        object_type="school",
        object_id=str(school_id),
        request=request,
        extra={"classes": len(plan), "cells": written},
    )
    db.commit()
    return TimetableImportResult(ok=True, written=written, errors=[])
