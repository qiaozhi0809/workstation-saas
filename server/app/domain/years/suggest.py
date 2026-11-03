"""学年升级建议:年级名推算与默认方案。"""

from datetime import date
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.domain.years.plan import ClassPlan, NewYear, UpgradePlan
from app.domain.years.service import UpgradeError

# 每条链按顺序;最后一个是毕业年级。下一年级保持同一种写法。
_CHAINS: list[list[str]] = [
    ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"],
    ["七年级", "八年级", "九年级"],
    ["初一", "初二", "初三"],
    ["高一", "高二", "高三"],
    ["十年级", "十一年级", "十二年级"],
]

_INDEX: dict[str, int] = {
    **{n: i + 1 for i, n in enumerate(_CHAINS[0])},
    **{n: i + 7 for i, n in enumerate(_CHAINS[1])},
    **{n: i + 7 for i, n in enumerate(_CHAINS[2])},
    **{n: i + 10 for i, n in enumerate(_CHAINS[3])},
    **{n: i + 10 for i, n in enumerate(_CHAINS[4])},
}


def grade_index(name: str) -> int | None:
    return _INDEX.get(name)


def next_grade(name: str) -> tuple[str | None, bool]:
    """(下一年级名, 是否毕业年级);认不出 → (None, False)。"""
    for chain in _CHAINS:
        if name in chain:
            i = chain.index(name)
            if i == len(chain) - 1:
                return None, True
            return chain[i + 1], False
    return None, False


def _stem(grade: str) -> str:
    return grade[:-1] if grade.endswith("级") else grade


def next_class_name(class_name: str, grade: str, nxt: str) -> str | None:
    old, new = _stem(grade), _stem(nxt)
    if old and old in class_name:
        return class_name.replace(old, new, 1)
    return None


def suggest(db: Session, school_id: UUID, name: str, start: date, end: date) -> UpgradePlan:
    year = db.execute(
        text("SELECT id FROM academic_years WHERE school_id = :s AND is_active"),
        {"s": school_id},
    ).first()
    if year is None:
        raise UpgradeError("NO_ACTIVE_YEAR", "学校还没有进行中的学年")
    rows = db.execute(
        text(
            "SELECT c.id, c.name, g.name AS grade_name, ta.teacher_id, u.display_name"
            " FROM classes c JOIN grades g ON g.id = c.grade_id"
            " LEFT JOIN LATERAL ("
            "   SELECT teacher_id FROM teacher_assignments"
            "   WHERE class_id = c.id AND academic_year_id = c.academic_year_id"
            "     AND identity = 'homeroom' AND ended_at IS NULL"
            "   ORDER BY started_at DESC LIMIT 1) ta ON true"
            " LEFT JOIN teachers t ON t.id = ta.teacher_id"
            " LEFT JOIN users u ON u.id = t.user_id"
            " WHERE c.academic_year_id = :y AND c.active"
            " ORDER BY g.display_order, c.name"
        ),
        {"y": year.id},
    ).all()
    classes: list[ClassPlan] = []
    for r in rows:
        nxt, graduating = next_grade(r.grade_name)
        if graduating:
            classes.append(ClassPlan(from_class_id=r.id, from_name=r.name, action="graduate"))
            continue
        classes.append(
            ClassPlan(
                from_class_id=r.id,
                from_name=r.name,
                action="promote",
                to_grade_name=nxt,
                to_name=next_class_name(r.name, r.grade_name, nxt) if nxt else None,
                homeroom_teacher_id=r.teacher_id,
                teacher_name=r.display_name,
                keep_teachers=True,
            )
        )
    return UpgradePlan(
        version=1,
        from_year_id=year.id,
        new_year=NewYear(name=name, start_date=start, end_date=end),
        classes=classes,
        students=[],
        new_classes=[],
    )
