from typing import Literal
from uuid import UUID

from sqlalchemy.orm import Session

from app.domain.exams.schemas import SubjectFull
from app.errors import ApiError
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


def grade_stage(grade: Grade | None) -> Stage:
    """年级的学段:管理端显式设置优先,没设就按年级名推断。"""
    if grade is None:
        return stage_of("")
    explicit = STAGE_KEY.get(grade.stage) if grade.stage else None
    return explicit or stage_of(grade.name)


def catalog_subjects(db: Session, school_id: UUID, stage: Stage) -> list[SubjectFull]:
    """学校科目目录里某学段的科目(副本;没存过目录就是内置预设)。"""
    # school_settings.service 反过来依赖本模块的 PRESETS / Stage,只能在函数里导入
    from app.domain.school_settings.service import get_catalog

    return get_catalog(db, school_id)[stage]


def _preset_for(db: Session, cls: SchoolClass) -> list[SubjectFull]:
    return catalog_subjects(db, cls.school_id, grade_stage(db.get(Grade, cls.grade_id)))


def class_subjects(db: Session, cls: SchoolClass) -> list[SubjectFull]:
    """班级自己的科目列表;还没有(没建过考试)时用学校目录里该学段的科目。"""
    if not cls.subjects:
        return _preset_for(db, cls)
    return [SubjectFull(**s) for s in cls.subjects]


def merge_subjects(db: Session, cls: SchoolClass, subjects: list[SubjectFull]) -> None:
    """锁住班级行,列表为空时先按目录初始化,再把没见过的科目追加到末尾。

    已有科目的满分不动。不 commit;行锁持续到调用方事务结束,两个并发写入者会一前一后
    在最新列表上追加,不会互相覆盖(L11)。
    """
    if db.get(SchoolClass, cls.id, with_for_update=True, populate_existing=True) is None:
        raise ApiError(404, "NOT_FOUND", "班级不存在")  # 等锁期间被并发删掉,同 org lock_class
    merged = class_subjects(db, cls)
    known = {s.name for s in merged}
    for s in subjects:
        if s.name not in known:
            merged.append(s)
            known.add(s.name)
    cls.subjects = [s.model_dump() for s in merged]


def fill_from_catalog(db: Session, cls: SchoolClass) -> list[SubjectFull]:
    """把目录里该班还没有的科目追加到末尾(已有的不改满分),提交并返回新列表。"""
    merge_subjects(db, cls, _preset_for(db, cls))
    db.commit()
    return class_subjects(db, cls)
