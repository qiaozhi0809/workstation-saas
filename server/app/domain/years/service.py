"""学年升级:方案校验、预览、执行与回滚。"""

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.audit.service import record
from app.domain.parents.lifecycle import close_links_for, reopen_links
from app.domain.years.plan import UpgradePlan
from app.models import YearUpgrade

STALE = "UPGRADE_PLAN_STALE"
INVALID = "UPGRADE_PLAN_INVALID"
NOTHING_TO_ROLLBACK = "UPGRADE_NOTHING_TO_ROLLBACK"
HAS_DATA = "UPGRADE_HAS_DATA"
NOT_LATEST = "UPGRADE_NOT_LATEST"


class UpgradeError(Exception):
    """方案不能用。`details` 指明出问题的位置:
    `{"section": "classes"|"students"|"new_classes"|"grade_heads"|"new_year", "index": int,
    "field": str}`(`new_year` 没有 index;`grade_heads` 的 field 是 `grade_name` 或
    `user_ids`;STALE 可无 details;可附带其他说明键)。"""

    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


@dataclass
class ClassPreview:
    from_name: str
    action: str  # promote | graduate | new
    to_label: str
    teacher_name: str | None
    follow: int
    repeat_in: int
    repeat_out: int
    leave: int
    graduate: int


@dataclass
class UpgradePreview:
    new_year: str
    classes: list[ClassPreview]
    new_classes: list[str]
    warnings: list[str]


@dataclass
class PlanContext:
    """校验通过后可复用的现状(apply 也用它)。"""

    class_names: dict[UUID, str] = field(default_factory=dict)
    class_grades: dict[UUID, str] = field(default_factory=dict)
    # enrollment_id -> class_id(旧学年 active 班里 active 的注册记录)
    enrollment_class: dict[UUID, UUID] = field(default_factory=dict)
    class_enrollments: dict[UUID, int] = field(default_factory=dict)
    teacher_names: dict[UUID, str] = field(default_factory=dict)


def _bad(section: str, index: int | None, fld: str, message: str, **extra: Any) -> UpgradeError:
    details: dict[str, Any] = {"section": section, "field": fld, **extra}
    if index is not None:
        details["index"] = index
    return UpgradeError(INVALID, message, details)


def check_plan(db: Session, school_id: UUID, plan: UpgradePlan) -> PlanContext:
    """校验方案并返回现状;不合法抛 UpgradeError。"""
    year = db.execute(
        text("SELECT id FROM academic_years WHERE school_id = :s AND is_active"),
        {"s": school_id},
    ).first()
    if year is None or year.id != plan.from_year_id:
        raise UpgradeError(STALE, "方案基于的学年已不是进行中的学年,请重新生成方案")

    ctx = PlanContext()
    for r in db.execute(
        text(
            "SELECT c.id, c.name, g.name AS grade_name FROM classes c"
            " JOIN grades g ON g.id = c.grade_id"
            " WHERE c.academic_year_id = :y AND c.active"
        ),
        {"y": year.id},
    ):
        ctx.class_names[r.id] = r.name
        ctx.class_grades[r.id] = r.grade_name
    planned = [c.from_class_id for c in plan.classes]
    if len(planned) != len(set(planned)) or set(planned) != set(ctx.class_names):
        raise UpgradeError(STALE, "方案里的班级与现在进行中的班级不一致,请重新生成方案")

    for r in db.execute(
        text(
            "SELECT id, class_id FROM enrollments"
            " WHERE academic_year_id = :y AND status = 'active' AND class_id = ANY(:cs)"
        ),
        {"y": year.id, "cs": list(ctx.class_names)},
    ):
        ctx.enrollment_class[r.id] = r.class_id
        ctx.class_enrollments[r.class_id] = ctx.class_enrollments.get(r.class_id, 0) + 1

    # 新学年名
    clash = db.execute(
        text("SELECT 1 FROM academic_years WHERE school_id = :s AND name = :n"),
        {"s": school_id, "n": plan.new_year.name},
    ).first()
    if clash:
        raise _bad("new_year", None, "name", f"学年名 {plan.new_year.name} 已存在")

    # 班级项
    seen_names: set[tuple[str, str]] = set()
    teacher_ids: dict[UUID, tuple[str, int]] = {}
    for i, c in enumerate(plan.classes):
        if c.action == "promote":
            if not c.to_grade_name:
                raise _bad(
                    "classes",
                    i,
                    "to_grade_name",
                    f"{ctx.class_names[c.from_class_id]} 缺少升入的年级",
                )
            if not c.to_name:
                raise _bad(
                    "classes", i, "to_name", f"{ctx.class_names[c.from_class_id]} 缺少新班名"
                )
            key = (c.to_grade_name, c.to_name)
            if key in seen_names:
                raise _bad(
                    "classes", i, "to_name", f"新学年 {c.to_grade_name} 出现重名班 {c.to_name}"
                )
            seen_names.add(key)
        if c.homeroom_teacher_id is not None and c.action == "promote":
            teacher_ids.setdefault(c.homeroom_teacher_id, ("classes", i))
    for j, n in enumerate(plan.new_classes):
        key = (n.grade_name, n.name)
        if key in seen_names:
            raise _bad("new_classes", j, "name", f"新学年 {n.grade_name} 出现重名班 {n.name}")
        seen_names.add(key)
        if n.homeroom_teacher_id is not None:
            teacher_ids.setdefault(n.homeroom_teacher_id, ("new_classes", j))

    # 老师必须存在(本校)
    if teacher_ids:
        for r in db.execute(
            text(
                "SELECT t.id, u.display_name FROM teachers t JOIN users u ON u.id = t.user_id"
                " WHERE u.school_id = :s AND t.id = ANY(:ids)"
            ),
            {"s": school_id, "ids": list(teacher_ids)},
        ):
            ctx.teacher_names[r.id] = r.display_name
    for c_i, c in enumerate(plan.classes):
        tid = c.homeroom_teacher_id
        if c.action == "promote" and tid is not None and tid not in ctx.teacher_names:
            raise _bad("classes", c_i, "homeroom_teacher_id", "找不到指定的班主任老师")
    for j, n in enumerate(plan.new_classes):
        tid = n.homeroom_teacher_id
        if tid is not None and tid not in ctx.teacher_names:
            raise _bad("new_classes", j, "homeroom_teacher_id", "找不到指定的班主任老师")

    # 年级组长(显式指定时)
    if plan.grade_heads is not None:
        new_grades = {c.to_grade_name for c in plan.classes if c.action == "promote"}
        new_grades |= {n.grade_name for n in plan.new_classes}
        wanted_users = {u for gh in plan.grade_heads for u in gh.user_ids}
        active_users: set[UUID] = set()
        if wanted_users:
            active_users = {
                r.id
                for r in db.execute(
                    text(
                        "SELECT id FROM users WHERE school_id = :s AND status = 'active'"
                        " AND id = ANY(:ids)"
                    ),
                    {"s": school_id, "ids": list(wanted_users)},
                )
            }
        seen_grades: set[str] = set()
        for i, gh in enumerate(plan.grade_heads):
            if gh.grade_name not in new_grades:
                raise _bad(
                    "grade_heads", i, "grade_name", f"新学年没有 {gh.grade_name},不能指定组长"
                )
            if gh.grade_name in seen_grades:
                raise _bad("grade_heads", i, "grade_name", f"{gh.grade_name} 的组长列了两次")
            seen_grades.add(gh.grade_name)
            if any(u not in active_users for u in gh.user_ids):
                raise _bad(
                    "grade_heads", i, "user_ids", f"{gh.grade_name} 的组长里有不存在或已停用的账号"
                )

    # 学生项
    by_class = {c.from_class_id: c for c in plan.classes}
    seen_enrollments: set[UUID] = set()
    for k, s in enumerate(plan.students):
        label = s.name or str(s.enrollment_id)
        if s.enrollment_id not in ctx.enrollment_class:
            raise _bad("students", k, "enrollment_id", f"{label} 不在旧学年进行中班级的在籍名单里")
        if s.enrollment_id in seen_enrollments:
            raise _bad("students", k, "enrollment_id", f"{label} 在方案里出现了两次")
        seen_enrollments.add(s.enrollment_id)
        if s.action != "repeat":
            continue
        assert s.to is not None
        current_grade = ctx.class_grades[ctx.enrollment_class[s.enrollment_id]]
        if s.to.new_class is not None:
            if not 0 <= s.to.new_class < len(plan.new_classes):
                raise _bad("students", k, "to", f"{label} 留级的新建班序号 {s.to.new_class} 不存在")
            target_grade = plan.new_classes[s.to.new_class].grade_name
        else:
            target = by_class.get(s.to.successor_of) if s.to.successor_of else None
            if target is None:
                raise _bad("students", k, "to", f"{label} 留级的目标班不在方案里")
            if target.action != "promote":
                raise _bad(
                    "students",
                    k,
                    "to",
                    f"{label} 留级的目标班 {ctx.class_names[target.from_class_id]} 毕业后没有新班",
                )
            target_grade = target.to_grade_name
        if target_grade != current_grade:
            raise _bad(
                "students",
                k,
                "to",
                f"{label} 留级的目标年级是 {target_grade},应与现在的 {current_grade} 一致",
            )
    return ctx


def validate(db: Session, school_id: UUID, plan: UpgradePlan) -> None:
    check_plan(db, school_id, plan)


def preview(db: Session, school_id: UUID, plan: UpgradePlan) -> UpgradePreview:
    ctx = check_plan(db, school_id, plan)
    exceptions = {s.enrollment_id: s for s in plan.students}
    rows: list[ClassPreview] = []
    new_rows = [
        ClassPreview(
            from_name=n.name,
            action="new",
            to_label=f"{n.grade_name} {n.name}",
            teacher_name=ctx.teacher_names.get(n.homeroom_teacher_id)
            if n.homeroom_teacher_id
            else None,
            follow=0,
            repeat_in=0,
            repeat_out=0,
            leave=0,
            graduate=0,
        )
        for n in plan.new_classes
    ]
    by_class: dict[UUID, ClassPreview] = {}
    for c in plan.classes:
        promote = c.action == "promote"
        row = ClassPreview(
            from_name=ctx.class_names[c.from_class_id],
            action=c.action,
            to_label=f"{c.to_grade_name} {c.to_name}" if promote else "毕业",
            teacher_name=ctx.teacher_names.get(c.homeroom_teacher_id)
            if promote and c.homeroom_teacher_id
            else None,
            follow=0,
            repeat_in=0,
            repeat_out=0,
            leave=0,
            graduate=0,
        )
        rows.append(row)
        by_class[c.from_class_id] = row
        total = ctx.class_enrollments.get(c.from_class_id, 0)
        out_repeat = out_leave = 0
        for eid, s in exceptions.items():
            if ctx.enrollment_class[eid] != c.from_class_id:
                continue
            if s.action == "repeat":
                out_repeat += 1
            else:
                out_leave += 1
        row.repeat_out, row.leave = out_repeat, out_leave
        rest = total - out_repeat - out_leave
        if promote:
            row.follow = rest
        else:
            row.graduate = rest
    for s in plan.students:
        if s.action == "repeat" and s.to is not None:
            if s.to.new_class is not None:
                new_rows[s.to.new_class].repeat_in += 1
            elif s.to.successor_of is not None:
                by_class[s.to.successor_of].repeat_in += 1

    warnings: list[str] = []
    homerooms: dict[UUID, list[str]] = {}
    targets: list[tuple[str, UUID | None]] = [
        (c.to_name or "", c.homeroom_teacher_id) for c in plan.classes if c.action == "promote"
    ] + [(n.name, n.homeroom_teacher_id) for n in plan.new_classes]
    for name, tid in targets:
        if tid is None:
            warnings.append(f"{name} 没有班主任")
        else:
            homerooms.setdefault(tid, []).append(name)
    for tid, names in homerooms.items():
        if len(names) > 1:
            warnings.append(f"{ctx.teacher_names[tid]} 同时是 {'、'.join(names)} 的班主任")

    labels = [
        f"{n.grade_name} {n.name}(班主任 {r.teacher_name or '未定'})"
        for n, r in zip(plan.new_classes, new_rows, strict=True)
    ]
    return UpgradePreview(
        new_year=plan.new_year.name,
        classes=rows + new_rows,
        new_classes=labels,
        warnings=warnings,
    )


# ---------------------------------------------------------------- 执行 / 回滚

# 新学年里产生的"事件"表,都带 class_id;回滚前逐个数一数新班里有没有行。
_EVENT_TABLES = (
    "attendances",
    "attendance_days",
    "reviews",
    "exams",
    "seat_arrangements",
    "growth_records",
    "comments",
    "ai_chats",
)


def _uuids(raw: list[str]) -> list[UUID]:
    return [UUID(x) for x in raw]


def _serialize_upgrades(db: Session, school_id: UUID) -> None:
    """apply / rollback 的第一步:同校的学年升级与回滚串行。

    先取事务级咨询锁(不依赖谓词,等锁期间行变了也不会被静默跳过),再锁进行中的学年行。
    学年行用 FOR NO KEY UPDATE 而不是 FOR UPDATE:持班级行锁的写入方(任命、加学生)随后
    插入带 academic_year_id 外键的行,外键会对学年行取 FOR KEY SHARE,与 FOR UPDATE 冲突,
    而与 FOR NO KEY UPDATE 相容,锁顺序因此统一为"先班级、后学年",不再死锁。
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:k)::bigint)"),
        {"k": f"year-upgrade:{school_id}"},
    )
    db.execute(
        text("SELECT id FROM academic_years WHERE school_id = :s AND is_active FOR NO KEY UPDATE"),
        {"s": school_id},
    ).all()


def apply(
    db: Session,
    school_id: UUID,
    plan: UpgradePlan,
    *,
    now: datetime,
    actor_id: UUID | None = None,
    request: Request | None = None,
    via: str = "cli",
) -> YearUpgrade:
    """在一个事务里执行升级并 commit;历史事件(考勤、点评、考试……)一行不动。"""
    from app.domain.years.suggest import grade_index  # suggest 反过来依赖本模块

    _serialize_upgrades(db, school_id)
    # 同一学年的在读班也锁上(按 id 排序防死锁),与 lock_class 的名册写入串行
    db.execute(
        text(
            "SELECT id FROM classes WHERE academic_year_id = :y AND active ORDER BY id FOR UPDATE"
        ),
        {"y": plan.from_year_id},
    ).all()
    ctx = check_plan(db, school_id, plan)
    old_year_id = plan.from_year_id

    # 1. 学年
    db.execute(
        text("UPDATE academic_years SET is_active = false WHERE id = :y"), {"y": old_year_id}
    )
    new_year_id = db.execute(
        text(
            "INSERT INTO academic_years (school_id, name, start_date, end_date, is_active)"
            " VALUES (:s, :n, :a, :b, true) RETURNING id"
        ),
        {
            "s": school_id,
            "n": plan.new_year.name,
            "a": plan.new_year.start_date,
            "b": plan.new_year.end_date,
        },
    ).scalar_one()

    # 2. 年级
    old_grade_rows = list(
        db.execute(
            text(
                "SELECT c.id, g.id AS grade_id, g.display_order FROM classes c"
                " JOIN grades g ON g.id = c.grade_id"
                " WHERE c.id = ANY(cast(:cs as uuid[]))"
            ),
            {"cs": list(ctx.class_names)},
        )
    )
    old_orders = {r.id: r.display_order for r in old_grade_rows}
    old_grade_of = {r.id: r.grade_id for r in old_grade_rows}
    fallback = max(old_orders.values(), default=0) + 1
    wanted: dict[str, int] = {}
    for c in plan.classes:
        if c.action == "promote" and c.to_grade_name and c.to_grade_name not in wanted:
            wanted[c.to_grade_name] = grade_index(c.to_grade_name) or (
                old_orders[c.from_class_id] + 1
            )
    for n in plan.new_classes:
        wanted.setdefault(n.grade_name, grade_index(n.grade_name) or fallback)
    grade_ids: dict[str, UUID] = {}
    for name, order in wanted.items():
        grade_ids[name] = db.execute(
            text(
                "INSERT INTO grades (school_id, academic_year_id, name, display_order)"
                " VALUES (:s, :y, :n, :o) RETURNING id"
            ),
            {"s": school_id, "y": new_year_id, "n": name, "o": order},
        ).scalar_one()

    # 3. 班级
    successor: dict[UUID, UUID] = {}
    new_class_ids: list[UUID] = []
    for c in plan.classes:
        if c.action != "promote":
            continue
        assert c.to_grade_name and c.to_name
        cid = db.execute(
            text(
                "INSERT INTO classes (school_id, academic_year_id, grade_id, name, seat_rows,"
                " seat_cols, subjects, seat_version, homeroom_teacher_id, desk_size,"
                " seat_layout, seat_order, podium_left, podium_right, room)"
                " SELECT school_id, :y, :g, :n, seat_rows, seat_cols, subjects, 0, :t,"
                " desk_size, seat_layout, seat_order, podium_left, podium_right, ''"
                " FROM classes WHERE id = :old RETURNING id"
            ),
            {
                "y": new_year_id,
                "g": grade_ids[c.to_grade_name],
                "n": c.to_name,
                "t": c.homeroom_teacher_id,
                "old": c.from_class_id,
            },
        ).scalar_one()
        successor[c.from_class_id] = cid
        new_class_ids.append(cid)
    fresh: list[UUID] = []
    for n in plan.new_classes:
        cid = db.execute(
            text(
                "INSERT INTO classes (school_id, academic_year_id, grade_id, name, seat_rows,"
                " seat_cols, seat_version, homeroom_teacher_id, desk_size, seat_layout)"
                " VALUES (:s, :y, :g, :n, :r, :c, 0, :t, :d, :l) RETURNING id"
            ),
            {
                "s": school_id,
                "y": new_year_id,
                "g": grade_ids[n.grade_name],
                "n": n.name,
                "r": n.seat_rows,
                "c": n.seat_cols,
                "d": n.desk_size,
                "l": n.seat_layout,
                "t": n.homeroom_teacher_id,
            },
        ).scalar_one()
        fresh.append(cid)
        new_class_ids.append(cid)
    old_class_ids = list(ctx.class_names)
    db.execute(text("UPDATE classes SET active = false WHERE id = ANY(:cs)"), {"cs": old_class_ids})
    # 教室摄像头跟着班级升入新班(L154);毕业班的不动。记下每一次改绑,回滚时按记录还原
    camera_rebinds: list[list[str]] = []
    for old_cid, new_cid in successor.items():
        for r in db.execute(
            text(
                "UPDATE cameras SET class_id = :new WHERE class_id = :old AND school_id = :s"
                " RETURNING id"
            ),
            {"new": new_cid, "old": old_cid, "s": school_id},
        ):
            camera_rebinds.append([str(r.id), str(old_cid), str(new_cid)])

    # 4. 注册记录
    exceptions = {s.enrollment_id: s for s in plan.students}
    by_class = {c.from_class_id: c for c in plan.classes}
    old_rows = db.execute(
        text(
            "SELECT id, student_id, class_id, seat_row, seat_col, seat_locked, class_role"
            " FROM enrollments WHERE id = ANY(cast(:ids as uuid[])) ORDER BY id"
        ),
        {"ids": list(ctx.enrollment_class)},
    ).all()
    status_of: dict[str, list[UUID]] = {"promoted": [], "graduated": [], "transferred": []}
    counts = {
        "classes": len(new_class_ids),
        "promoted": 0,
        "repeated": 0,
        "graduated": 0,
        "left": 0,
    }
    new_enrollment_ids: list[UUID] = []
    new_enrollment_roles: dict[str, str | None] = {}
    new_enrollment_classes: dict[str, str] = {}  # 新注册 → 升级时放进的新班(回滚检查 L51)
    insert_enr = text(
        "INSERT INTO enrollments (student_id, class_id, academic_year_id, seat_row, seat_col,"
        " seat_locked, class_role, entered_at, status)"
        " VALUES (:st, :c, :y, :r, :cl, :lk, :role, :now, 'active') RETURNING id"
    )
    for r in old_rows:
        ex = exceptions.get(r.id)
        target: UUID | None = None
        keep_seat = False
        if ex is not None and ex.action == "leave":
            status_of["transferred"].append(r.id)
            counts["left"] += 1
        elif ex is not None:
            assert ex.to is not None
            target = fresh[ex.to.new_class] if ex.to.new_class is not None else None
            if ex.to.successor_of is not None:
                target = successor[ex.to.successor_of]
            status_of["promoted"].append(r.id)
            counts["repeated"] += 1
        elif by_class[r.class_id].action == "graduate":
            status_of["graduated"].append(r.id)
            counts["graduated"] += 1
        else:
            target = successor[r.class_id]
            keep_seat = True
            status_of["promoted"].append(r.id)
            counts["promoted"] += 1
        if target is not None:
            role = r.class_role if keep_seat else None
            new_id = db.execute(
                insert_enr,
                {
                    "st": r.student_id,
                    "c": target,
                    "y": new_year_id,
                    "r": r.seat_row if keep_seat else None,
                    "cl": r.seat_col if keep_seat else None,
                    "lk": r.seat_locked if keep_seat else False,
                    "role": role,
                    "now": now,
                },
            ).scalar_one()
            new_enrollment_ids.append(new_id)
            new_enrollment_roles[str(new_id)] = role
            new_enrollment_classes[str(new_id)] = str(target)
    for status, ids in status_of.items():
        if ids:
            db.execute(
                text("UPDATE enrollments SET status = :st, left_at = :now WHERE id = ANY(:ids)"),
                {"st": status, "now": now, "ids": ids},
            )
    # 毕业 / 转出的学生不再有在读注册:家长绑定转只读
    closed = {*status_of["graduated"], *status_of["transferred"]}
    parent_links_readonly = close_links_for(
        db, [r.student_id for r in old_rows if r.id in closed], now
    )

    # 5. 任职
    old_assignments = db.execute(
        text(
            "SELECT id, teacher_id, class_id, identity, subject FROM teacher_assignments"
            " WHERE academic_year_id = :y AND ended_at IS NULL ORDER BY id"
        ),
        {"y": old_year_id},
    ).all()
    old_assignment_ids = [a.id for a in old_assignments]
    if old_assignment_ids:
        db.execute(
            text("UPDATE teacher_assignments SET ended_at = :now WHERE id = ANY(:ids)"),
            {"now": now, "ids": old_assignment_ids},
        )
    wanted_assignments: list[
        tuple[UUID, UUID, str, str | None]
    ] = []  # teacher, class, identity, subject
    for c in plan.classes:
        if c.action != "promote":
            continue
        cid = successor[c.from_class_id]
        if c.homeroom_teacher_id is not None:
            # 原班主任继续带新班时,保留他原来的任课科目
            kept_subject = next(
                (
                    a.subject
                    for a in old_assignments
                    if a.class_id == c.from_class_id
                    and a.identity == "homeroom"
                    and a.teacher_id == c.homeroom_teacher_id
                ),
                None,
            )
            wanted_assignments.append((c.homeroom_teacher_id, cid, "homeroom", kept_subject))
        if c.keep_teachers:
            wanted_assignments += [
                (a.teacher_id, cid, a.identity, a.subject)
                for a in old_assignments
                if a.class_id == c.from_class_id and a.identity in ("subject", "assistant")
            ]
    for n, cid in zip(plan.new_classes, fresh, strict=True):
        if n.homeroom_teacher_id is not None:
            wanted_assignments.append((n.homeroom_teacher_id, cid, "homeroom", None))
    new_assignment_ids: list[UUID] = []
    new_binding_ids: list[UUID] = []
    teacher_user = {
        r.id: r.user_id
        for r in db.execute(
            text("SELECT id, user_id FROM teachers WHERE id = ANY(cast(:ids as uuid[]))"),
            {"ids": list({w[0] for w in wanted_assignments})},
        )
    }
    role_of = {
        "homeroom": "homeroom_teacher",
        "subject": "subject_teacher",
        "assistant": "assistant_teacher",
    }
    for teacher_id, cid, identity, subject in wanted_assignments:
        new_assignment_ids.append(
            db.execute(
                text(
                    "INSERT INTO teacher_assignments (teacher_id, class_id, academic_year_id,"
                    " identity, subject, started_at) VALUES (:t, :c, :y, :i, :sub, :now)"
                    " RETURNING id"
                ),
                {
                    "t": teacher_id,
                    "c": cid,
                    "y": new_year_id,
                    "i": identity,
                    "sub": subject,
                    "now": now,
                },
            ).scalar_one()
        )
        scope: dict[str, str] = {"class_id": str(cid)}
        if identity == "subject" and subject:
            scope["subject"] = subject
        new_binding_ids.append(
            _insert_binding(
                db, teacher_user[teacher_id], role_of[identity], scope, new_year_id, now
            )
        )
    # 课表随班升入新学年(L154):只复制升级班(新建班没有课表);任课老师只有在"保留任课老师"
    # 且这位老师在新班仍有任职(任一身份)时才保留,否则置空。放在任职之后,因为要看 wanted_assignments
    teachers_in_class: dict[UUID, set[UUID]] = {}
    for teacher_id, cid, _identity, _subject in wanted_assignments:
        teachers_in_class.setdefault(cid, set()).add(teacher_id)
    for c in plan.classes:
        if c.action != "promote":
            continue
        cid = successor[c.from_class_id]
        keep = sorted(teachers_in_class.get(cid, set()), key=str) if c.keep_teachers else []
        db.execute(
            text(
                "INSERT INTO timetable_entries"
                " (class_id, academic_year_id, weekday, period_no, subject, teacher_id)"
                " SELECT :new, :new_year, weekday, period_no, subject,"
                " CASE WHEN teacher_id = ANY(cast(:keep as uuid[])) THEN teacher_id END"
                " FROM timetable_entries WHERE class_id = :old AND academic_year_id = :old_year"
            ),
            {
                "new": cid,
                "new_year": new_year_id,
                "keep": keep,
                "old": c.from_class_id,
                "old_year": old_year_id,
            },
        )

    # 6. 旧绑定结束;非班级作用域的(校级等)复制到新学年
    old_bindings = db.execute(
        text(
            "SELECT id, user_id, role_type, scope FROM role_bindings"
            " WHERE academic_year_id = :y AND ended_at IS NULL ORDER BY id"
        ),
        {"y": old_year_id},
    ).all()
    old_binding_ids = [b.id for b in old_bindings]
    if old_binding_ids:
        db.execute(
            text("UPDATE role_bindings SET ended_at = :now WHERE id = ANY(:ids)"),
            {"now": now, "ids": old_binding_ids},
        )
    # 旧年级 → 新年级:该年级升级班里占多数的目标年级(并列取 display_order 小、再取名字小的)
    votes: dict[UUID, dict[str, int]] = {}
    for c in plan.classes:
        if c.action == "promote" and c.to_grade_name:
            v = votes.setdefault(old_grade_of[c.from_class_id], {})
            v[c.to_grade_name] = v.get(c.to_grade_name, 0) + 1
    grade_successor = {
        old_g: grade_ids[min(v, key=lambda n: (-v[n], wanted[n], n))] for old_g, v in votes.items()
    }
    explicit_heads = plan.grade_heads is not None
    for b in old_bindings:
        scope = dict(b.scope or {})
        if "class_id" in scope:
            continue
        if b.role_type == "grade_head" and explicit_heads:
            continue  # 显式指定了组长:旧绑定一个都不复制
        if scope.get("grade_id"):
            # 年级作用域的绑定跟届走;整个年级毕业(或不在方案里)则不复制
            target = grade_successor.get(UUID(scope["grade_id"]))
            if target is None:
                continue
            scope["grade_id"] = str(target)
        new_binding_ids.append(_insert_binding(db, b.user_id, b.role_type, scope, new_year_id, now))
    for gh in plan.grade_heads or []:
        for user_id in dict.fromkeys(gh.user_ids):  # 同一人在同一年级只建一条
            new_binding_ids.append(
                _insert_binding(
                    db,
                    user_id,
                    "grade_head",
                    {"grade_id": str(grade_ids[gh.grade_name])},
                    new_year_id,
                    now,
                )
            )

    # 7. 记录
    def s(values: list[UUID]) -> list[str]:
        return [str(v) for v in values]

    summary = {
        "new_year_id": str(new_year_id),
        "new_grade_ids": s(list(grade_ids.values())),
        "new_class_ids": s(new_class_ids),
        "new_enrollment_ids": s(new_enrollment_ids),
        "new_enrollment_roles": new_enrollment_roles,
        "new_enrollment_classes": new_enrollment_classes,
        "old_enrollment_ids": s([r.id for r in old_rows]),
        "old_class_ids": s(old_class_ids),
        "new_assignment_ids": s(new_assignment_ids),
        "old_assignment_ids": s(old_assignment_ids),
        "new_binding_ids": s(new_binding_ids),
        "old_binding_ids": s(old_binding_ids),
        "parent_links_readonly": s(parent_links_readonly),
        "camera_rebinds": camera_rebinds,  # [[camera_id, 旧班, 新班], …]
        "counts": counts,
    }
    up = YearUpgrade(
        school_id=school_id,
        from_year_id=old_year_id,
        to_year_id=new_year_id,
        plan=plan.model_dump(mode="json"),
        summary=summary,
        executed_at=now,
    )
    db.add(up)
    db.flush()
    # 8. 审计
    record(
        db,
        user_id=actor_id,
        action="year.upgrade",
        success=True,
        object_type="academic_year",
        object_id=str(new_year_id),
        request=request,
        extra={**counts, "via": via},
    )
    db.commit()
    return up


def _insert_binding(
    db: Session,
    user_id: UUID,
    role_type: str,
    scope: dict[str, Any],
    year_id: UUID,
    now: datetime,
) -> UUID:
    return db.execute(
        text(
            "INSERT INTO role_bindings (user_id, role_type, scope, academic_year_id, started_at)"
            " VALUES (:u, :r, cast(:sc as jsonb), :y, :now) RETURNING id"
        ),
        {"u": user_id, "r": role_type, "sc": json.dumps(scope), "y": year_id, "now": now},
    ).scalar_one()


def latest_rollbackable(db: Session, school_id: UUID, *, lock: bool = False) -> YearUpgrade:
    q = (
        select(YearUpgrade)
        .where(YearUpgrade.school_id == school_id, YearUpgrade.rolled_back_at.is_(None))
        .order_by(YearUpgrade.executed_at.desc(), YearUpgrade.created_at.desc())
        .limit(1)
    )
    up = db.scalars(q.with_for_update() if lock else q).first()
    if up is None:
        raise UpgradeError(NOTHING_TO_ROLLBACK, "没有可以回滚的学年升级")
    return up


def _edits_since_upgrade(
    db: Session, up: YearUpgrade, new_classes: list[UUID], new_enrollments: list[UUID]
) -> dict[str, int]:
    """升级之后,新学年里被人动过的东西:看板、座位、班干部、转出、换到另一个新班、手动新建的
    年级 / 班级 / 任职 / 管理岗绑定、年级联考。非零才返回。"""
    sm = up.summary
    found: dict[str, int] = {}
    cs = {"cs": new_classes}
    # apply 不创建看板行,所以新班上有任何看板行都是升级后被人保存过的;不拿 updated_at 去比
    # 应用时钟,免得库时钟与应用时钟有偏差时漏判。
    boards = db.execute(
        text("SELECT count(*) FROM class_boards WHERE class_id = ANY(cast(:cs as uuid[]))"), cs
    ).scalar_one()
    if boards:
        found["class_boards"] = boards
    seats = db.execute(
        text(
            "SELECT count(*) FROM classes WHERE id = ANY(cast(:cs as uuid[])) AND seat_version > 0"
        ),
        cs,
    ).scalar_one()
    if seats:
        found["seats"] = seats
    recorded: dict[str, str | None] | None = sm.get("new_enrollment_roles")
    # 升级时放进的班(L51):新注册被改到另一个新班时 status 仍是 active,只能对着记录比
    placed: dict[str, str] | None = sm.get("new_enrollment_classes")
    if recorded is not None or placed is not None:  # 没有这些键的旧升级记录跳过对应检查
        changed = moved = 0
        for r in db.execute(
            text(
                "SELECT id, class_role, class_id FROM enrollments"
                " WHERE id = ANY(cast(:es as uuid[]))"
            ),
            {"es": new_enrollments},
        ):
            if recorded is not None and recorded.get(str(r.id)) != r.class_role:
                changed += 1
            if placed is not None and placed.get(str(r.id)) != str(r.class_id):
                moved += 1
        if changed:
            found["class_roles"] = changed
        if moved:
            found["class_changes"] = moved
    transfers = db.execute(
        text(
            "SELECT count(*) FROM enrollments"
            " WHERE id = ANY(cast(:es as uuid[])) AND status <> 'active'"
        ),
        {"es": new_enrollments},
    ).scalar_one()
    if transfers:
        found["transfers"] = transfers
    # 升级之后在新学年里手动新建的年级 / 班级 / 任职 / 管理岗绑定:不在升级记录里,删学年时会
    # 被级联静默抹掉(M3a 起组织架构页可以写这些)
    year = {"y": UUID(sm["new_year_id"])}
    for key, sql, ids in (
        (
            "new_grades",
            "SELECT count(*) FROM grades WHERE academic_year_id = :y"
            " AND NOT (id = ANY(cast(:ids as uuid[])))",
            sm["new_grade_ids"],
        ),
        (
            "new_classes",
            "SELECT count(*) FROM classes WHERE academic_year_id = :y"
            " AND NOT (id = ANY(cast(:ids as uuid[])))",
            sm["new_class_ids"],
        ),
        (
            "new_assignments",
            "SELECT count(*) FROM teacher_assignments WHERE academic_year_id = :y"
            " AND NOT (id = ANY(cast(:ids as uuid[])))",
            sm["new_assignment_ids"],
        ),
        (
            # 班级作用域的绑定总是跟着任职走(已由 new_assignments 计数),这里只数管理岗
            "new_bindings",
            "SELECT count(*) FROM role_bindings WHERE academic_year_id = :y"
            " AND NOT (scope ? 'class_id') AND NOT (id = ANY(cast(:ids as uuid[])))",
            sm["new_binding_ids"],
        ),
    ):
        n = db.execute(text(sql), {**year, "ids": _uuids(ids)}).scalar_one()
        if n:
            found[key] = n
    grade_exams = db.execute(
        text(
            "SELECT count(*) FROM grade_exams"
            " WHERE academic_year_id = :y OR grade_id = ANY(cast(:gs as uuid[]))"
        ),
        {"y": UUID(sm["new_year_id"]), "gs": _uuids(sm["new_grade_ids"])},
    ).scalar_one()
    if grade_exams:
        found["grade_exams"] = grade_exams
    return found


def rollback(
    db: Session,
    school_id: UUID,
    *,
    now: datetime,
    actor_id: UUID | None = None,
    request: Request | None = None,
    via: str = "cli",
    upgrade_id: UUID | None = None,
) -> YearUpgrade:
    """回滚最近一次未回滚的升级;新学年已有数据时拒绝。给了 upgrade_id 但不是最近一次则拒绝。"""
    # 与 apply 串行,否则 rollback 可能在 apply 提交前就选定了要回滚的升级,随后与 apply
    # 互相等锁(死锁)或回滚掉已被后续升级用作起点的学年。
    _serialize_upgrades(db, school_id)
    up = latest_rollbackable(db, school_id, lock=True)
    if upgrade_id is not None and upgrade_id != up.id:
        raise UpgradeError(
            NOT_LATEST,
            "只能回滚最近一次学年升级,请刷新后重试",
            {"latest_id": str(up.id)},
        )
    sm = up.summary
    new_classes = _uuids(sm["new_class_ids"])
    new_enrollments = _uuids(sm["new_enrollment_ids"])

    # 锁住新班(按 id 排序),与并发的名册写入串行,再数有没有新数据
    db.execute(
        text("SELECT id FROM classes WHERE id = ANY(CAST(:ids AS uuid[])) ORDER BY id FOR UPDATE"),
        {"ids": new_classes},
    ).all()

    found: dict[str, int] = {}
    for table in _EVENT_TABLES:
        n = db.execute(
            text(f"SELECT count(*) FROM {table} WHERE class_id = ANY(cast(:cs as uuid[]))"),
            {"cs": new_classes},
        ).scalar_one()
        if n:
            found[table] = n
    # 整个新学年里不在升级记录中的注册(含升级后手动新建的班里的学生)
    extra_students = db.execute(
        text(
            "SELECT count(*) FROM enrollments WHERE academic_year_id = :y"
            " AND NOT (id = ANY(cast(:es as uuid[])))"
        ),
        {"y": UUID(sm["new_year_id"]), "es": new_enrollments},
    ).scalar_one()
    if extra_students:
        found["new_students"] = extra_students
    found.update(_edits_since_upgrade(db, up, new_classes, new_enrollments))
    if found:
        raise UpgradeError(HAS_DATA, "新学年已经产生数据,不能回滚", found)

    def delete(table: str, ids: list[UUID]) -> None:
        db.execute(text(f"DELETE FROM {table} WHERE id = ANY(cast(:ids as uuid[]))"), {"ids": ids})

    delete("role_bindings", _uuids(sm["new_binding_ids"]))
    delete("teacher_assignments", _uuids(sm["new_assignment_ids"]))
    delete("enrollments", new_enrollments)
    # 摄像头回旧班(L154):只还原仍指向新班的;升级后被人手动改绑的不动。必须在删新班之前,
    # 否则外键 ON DELETE SET NULL 先把 class_id 清空,就认不出来了。旧升级记录没有这个键
    for cam_id, old_cid, new_cid in sm.get("camera_rebinds", []):
        db.execute(
            text("UPDATE cameras SET class_id = :old WHERE id = :cam AND class_id = :new"),
            {"old": UUID(old_cid), "cam": UUID(cam_id), "new": UUID(new_cid)},
        )
    delete("classes", new_classes)  # class_boards、复制的课表随级联删除
    delete("grades", _uuids(sm["new_grade_ids"]))
    # 新学年若是更早一次已回滚升级的 from_year,先清掉那些行(审计日志仍留有记录)
    db.execute(
        text("DELETE FROM year_upgrades WHERE from_year_id = :y AND rolled_back_at IS NOT NULL"),
        {"y": UUID(sm["new_year_id"])},
    )
    delete("academic_years", [UUID(sm["new_year_id"])])

    def restore(sql: str, ids: list[UUID]) -> None:
        db.execute(text(sql), {"ids": ids})

    db.execute(
        text("UPDATE academic_years SET is_active = true WHERE id = :y"), {"y": up.from_year_id}
    )
    restore(
        "UPDATE classes SET active = true WHERE id = ANY(cast(:ids as uuid[]))",
        _uuids(sm["old_class_ids"]),
    )
    restore(
        "UPDATE enrollments SET status = 'active', left_at = NULL"
        " WHERE id = ANY(cast(:ids as uuid[]))",
        _uuids(sm["old_enrollment_ids"]),
    )
    restore(
        "UPDATE teacher_assignments SET ended_at = NULL WHERE id = ANY(cast(:ids as uuid[]))",
        _uuids(sm["old_assignment_ids"]),
    )
    restore(
        "UPDATE role_bindings SET ended_at = NULL WHERE id = ANY(cast(:ids as uuid[]))",
        _uuids(sm["old_binding_ids"]),
    )
    reopen_links(db, _uuids(sm.get("parent_links_readonly", [])))
    db.execute(
        text("UPDATE year_upgrades SET rolled_back_at = :now WHERE id = :id"),
        {"now": now, "id": up.id},
    )
    record(
        db,
        user_id=actor_id,
        action="year.rollback",
        success=True,
        object_type="academic_year",
        object_id=sm["new_year_id"],
        request=request,
        extra={**sm["counts"], "via": via},
    )
    db.commit()
    db.refresh(up)
    return up
