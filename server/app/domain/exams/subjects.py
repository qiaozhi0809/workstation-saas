from typing import Literal

from sqlalchemy.orm import Session

from app.domain.exams.schemas import SubjectFull
from app.models import Grade, SchoolClass

Stage = Literal["primary", "junior", "senior"]


def stage_of(grade_name: str) -> Stage:
    if "高" in grade_name:
        return "senior"
    if "初" in grade_name or any(c in grade_name for c in "七八九"):
        return "junior"
    if "年级" in grade_name and any(c in grade_name for c in "一二三四五六"):
        return "primary"
    return "junior"


def _preset(names: list[str], full: int) -> list[SubjectFull]:
    return [SubjectFull(name=n, full=full) for n in names]


PRESETS: dict[Stage, list[SubjectFull]] = {
    "primary": _preset(["语文", "数学", "英语", "科学", "道法"], 100),
    "junior": _preset(["语文", "数学", "英语"], 120)
    + _preset(["物理", "化学", "道法", "历史", "地理", "生物"], 100),
    "senior": _preset(["语文", "数学", "英语"], 150)
    + _preset(["物理", "化学", "生物", "政治", "历史", "地理"], 100),
}


STAGE_KEY: dict[str, Stage] = {"小学": "primary", "初中": "junior", "高中": "senior"}


def _preset_for(db: Session, cls: SchoolClass) -> list[SubjectFull]:
    grade = db.get(Grade, cls.grade_id)
    stage = STAGE_KEY.get(grade.stage) if grade and grade.stage else None
    return [s.model_copy() for s in PRESETS[stage or stage_of(grade.name if grade else "")]]


def class_subjects(db: Session, cls: SchoolClass) -> list[SubjectFull]:
    if not cls.subjects:
        return _preset_for(db, cls)
    return [SubjectFull(**s) for s in cls.subjects]


def merge_subjects(db: Session, cls: SchoolClass, subjects: list[SubjectFull]) -> None:
    """Initialise the class list from the preset if empty, then append unseen names.

    Existing subjects keep their full marks. Does not commit.
    """
    merged = class_subjects(db, cls)
    known = {s.name for s in merged}
    for s in subjects:
        if s.name not in known:
            merged.append(s)
            known.add(s.name)
    cls.subjects = [s.model_dump() for s in merged]
