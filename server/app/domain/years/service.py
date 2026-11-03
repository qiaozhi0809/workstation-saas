"""学年升级:方案校验与预览(执行 / 回滚由后续任务加入)。"""

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.domain.years.plan import UpgradePlan

STALE = "UPGRADE_PLAN_STALE"
INVALID = "UPGRADE_PLAN_INVALID"


class UpgradeError(Exception):
    """方案不能用。`details` 指明出问题的位置:
    `{"section": "classes"|"students"|"new_classes"|"new_year", "index": int, "field": str}`
    (`new_year` 没有 index;STALE 可无 details;可附带其他说明键)。"""

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
