from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from fastapi import Request
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.audit.service import record
from app.domain.classes.sort import class_sort_key
from app.domain.exams.schemas import SubjectFull
from app.domain.exams.subjects import catalog_subjects, grade_stage, merge_subjects
from app.domain.grade_exams.schemas import (
    GradeExamClass,
    GradeExamInput,
    GradeExamOut,
    MissingClass,
)
from app.domain.schools.service import active_academic_year, require_active_year
from app.errors import ApiError
from app.models import AcademicYear, Enrollment, Exam, Grade, GradeExam, SchoolClass, Score, User
from app.rbac.bindings import Binding, Scope, can
from app.rbac.roles import LEADER_ROLES, Perm


def get_grade_in_school(db: Session, school_id: UUID, grade_id: UUID) -> Grade:
    grade = db.get(Grade, grade_id)
    if grade is None or grade.school_id != school_id:
        raise ApiError(404, "NOT_FOUND", "年级不存在")
    return grade


def _ensure_in_catalog(
    db: Session, grade: Grade, subjects: Sequence[SubjectFull], keep: set[str]
) -> None:
    """联考科目必须在该年级学段的科目目录里(L37);``keep`` 是已有联考里可以保留的科目名。"""
    allowed = {s.name for s in catalog_subjects(db, grade.school_id, grade_stage(grade))} | keep
    for s in subjects:
        if s.name not in allowed:
            raise ApiError(
                400,
                "SUBJECT_NOT_IN_CATALOG",
                f"「{s.name}」不在本学段的科目目录里,请先到学校设置里添加",
                {"subject": s.name},
            )


def get_grade_exam(
    db: Session, school_id: UUID, grade_exam_id: UUID, *, lock: bool = False
) -> GradeExam:
    """``lock`` takes the row FOR UPDATE: update / delete / sync serialise per grade exam."""
    if lock:
        ge = db.get(GradeExam, grade_exam_id, with_for_update=True, populate_existing=True)
    else:
        ge = db.get(GradeExam, grade_exam_id)
    if ge is None or ge.school_id != school_id:
        raise ApiError(404, "NOT_FOUND", "联考不存在")
    year = active_academic_year(db, school_id)
    if year is None or ge.academic_year_id != year.id:  # 往年联考视为不存在
        raise ApiError(404, "NOT_FOUND", "联考不存在")
    return ge


def _class_order(name: str, class_id: UUID) -> tuple:
    """班名按数值排(三年二班 < 三年三班 < 三年十班,L40),同名再按 id。"""
    return (class_sort_key(name), str(class_id))


def _grade_classes(
    db: Session, school_id: UUID, year_id: UUID, grade_id: UUID
) -> list[SchoolClass]:
    """Active classes of the grade in that year, by name."""
    classes = db.scalars(
        select(SchoolClass).where(
            SchoolClass.school_id == school_id,
            SchoolClass.academic_year_id == year_id,
            SchoolClass.grade_id == grade_id,
            SchoolClass.active.is_(True),
        )
    ).all()
    return sorted(classes, key=lambda c: _class_order(c.name, c.id))


def _lock_classes(db: Session, classes: Sequence[SchoolClass]) -> None:
    """先按 id 升序锁住要建考试的班级行(与学年升级、课表导入同序,防死锁),再碰学年行(L56):
    名册 / 任职写入也是"先班级、后学年(外键 KEY SHARE)",与回滚"先班级、后学年 FOR UPDATE"同序。"""
    if classes:
        db.execute(
            select(SchoolClass.id)
            .where(SchoolClass.id.in_([c.id for c in classes]))
            .order_by(SchoolClass.id)
            .with_for_update()
        ).all()


def _ensure_year_live(db: Session, year_id: UUID) -> None:
    """对学年行取 KEY SHARE(与回滚持有的 FOR UPDATE 互斥):回滚进行中就等它结束;等到时学年
    已被回滚删掉或已被升级停用 → 409,而不是写进一个马上被级联删掉 / 已成往年的学年(L56)。"""
    row = db.execute(
        text("SELECT is_active FROM academic_years WHERE id = :y FOR KEY SHARE"), {"y": year_id}
    ).first()
    if row is None or not row[0]:
        raise ApiError(409, "NO_ACTIVE_YEAR", "学年刚被升级或回滚,请刷新后重试")


def _new_exam(ge: GradeExam, cls: SchoolClass, user_id: UUID, now: datetime) -> Exam:
    return Exam(
        class_id=cls.id,
        academic_year_id=ge.academic_year_id,
        grade_exam_id=ge.id,
        name=ge.name,
        exam_type=ge.exam_type,
        date=ge.date,
        subjects=[dict(s) for s in ge.subjects],
        created_by_user_id=user_id,
        created_at=now,
        updated_at=now,
    )


ExamRow = tuple[UUID, UUID, UUID, str]  # (grade_exam_id, exam_id, class_id, class_name)


def _exam_rows(db: Session, ges: Sequence[GradeExam]) -> list[ExamRow]:
    """各联考已建考试的班,按班名数值序。"""
    rows = db.execute(
        select(Exam.grade_exam_id, Exam.id, SchoolClass.id, SchoolClass.name)
        .join(SchoolClass, SchoolClass.id == Exam.class_id)
        .where(Exam.grade_exam_id.in_([ge.id for ge in ges]))
    ).all()
    return sorted(((r[0], r[1], r[2], r[3]) for r in rows), key=lambda r: _class_order(r[3], r[2]))


def _progress_rows(
    db: Session, ges: Sequence[GradeExam], rows: Sequence[ExamRow]
) -> dict[UUID, list[GradeExamClass]]:
    """每场联考每个已建考试的班一行:已录格数 / 应录格数。整批两条聚合查询,与联考数无关(L38)。"""
    out: dict[UUID, list[GradeExamClass]] = {ge.id: [] for ge in ges}
    if not rows:
        return out
    entered: dict[tuple[UUID, str], int] = {}
    for exam_id, subject, n in db.execute(
        select(Score.exam_id, Score.subject, func.count())
        .join(Enrollment, Enrollment.id == Score.enrollment_id)
        .where(Score.exam_id.in_([r[1] for r in rows]), Enrollment.status == "active")
        .group_by(Score.exam_id, Score.subject)
    ):
        entered[(exam_id, subject)] = n
    students = dict(
        db.execute(
            select(Enrollment.class_id, func.count())
            .where(Enrollment.class_id.in_({r[2] for r in rows}), Enrollment.status == "active")
            .group_by(Enrollment.class_id)
        ).all()
    )
    names = {ge.id: [s["name"] for s in ge.subjects] for ge in ges}
    for ge_id, exam_id, class_id, class_name in rows:
        subs = names[ge_id]  # 只数联考现有科目的格子(考试表里可能留有已去掉科目的分)
        out[ge_id].append(
            GradeExamClass(
                class_id=class_id,
                class_name=class_name,
                exam_id=exam_id,
                entered=sum(entered.get((exam_id, s), 0) for s in subs),
                expected=students.get(class_id, 0) * len(subs),
            )
        )
    return out


def progress(db: Session, ge: GradeExam) -> list[GradeExamClass]:
    """One row per class that has the exam; entered cells / expected cells."""
    return _progress_rows(db, [ge], _exam_rows(db, [ge]))[ge.id]


def _missing_classes(db: Session, ge: GradeExam) -> list[SchoolClass]:
    have = set(db.scalars(select(Exam.class_id).where(Exam.grade_exam_id == ge.id)).all())
    classes = _grade_classes(db, ge.school_id, ge.academic_year_id, ge.grade_id)
    return [c for c in classes if c.id not in have]


def grade_exam_outs(db: Session, ges: Sequence[GradeExam]) -> list[GradeExamOut]:
    """整批序列化:考试班、已录格数、在读人数、年级名、年级在读班各一条查询,查询数不随联考数增长(L38)。"""
    if not ges:
        return []
    rows = _exam_rows(db, ges)
    progress_of = _progress_rows(db, ges, rows)
    grades = {
        g.id: g for g in db.scalars(select(Grade).where(Grade.id.in_({ge.grade_id for ge in ges})))
    }
    grade_classes: dict[tuple[UUID, UUID], list[SchoolClass]] = {}
    for cls in db.scalars(
        select(SchoolClass).where(
            SchoolClass.school_id.in_({ge.school_id for ge in ges}),
            SchoolClass.academic_year_id.in_({ge.academic_year_id for ge in ges}),
            SchoolClass.grade_id.in_(grades),
            SchoolClass.active.is_(True),
        )
    ):
        grade_classes.setdefault((cls.academic_year_id, cls.grade_id), []).append(cls)
    have: dict[UUID, set[UUID]] = {ge.id: set() for ge in ges}
    for ge_id, _exam_id, class_id, _name in rows:
        have[ge_id].add(class_id)
    return [
        GradeExamOut(
            id=ge.id,
            grade_id=ge.grade_id,
            grade_name=grades[ge.grade_id].name,
            name=ge.name,
            exam_type=ge.exam_type,
            date=ge.date,
            subjects=[SubjectFull(**s) for s in ge.subjects],
            classes=progress_of[ge.id],
            missing_classes=[
                MissingClass(class_id=c.id, class_name=c.name)
                for c in sorted(
                    grade_classes.get((ge.academic_year_id, ge.grade_id), []),
                    key=lambda c: _class_order(c.name, c.id),
                )
                if c.id not in have[ge.id]
            ],
        )
        for ge in ges
    ]


def grade_exam_out(db: Session, ge: GradeExam) -> GradeExamOut:
    return grade_exam_outs(db, [ge])[0]


def _visible_grade_ids(bindings: Sequence[Binding], year: AcademicYear) -> set[UUID] | None:
    """school.view 可见的年级:None = 全校;否则只含领导身份绑定的年级。"""
    leaders = [b for b in bindings if b.role in LEADER_ROLES]
    if can(leaders, Perm.CLASS_READ, Scope(school_id=year.school_id)):
        return None
    return {b.scope.grade_id for b in leaders if b.scope.grade_id is not None}


def list_grade_exams(
    db: Session, bindings: Sequence[Binding], year: AcademicYear, grade_id: UUID | None
) -> list[GradeExamOut]:
    stmt = (
        select(GradeExam)
        .where(GradeExam.school_id == year.school_id, GradeExam.academic_year_id == year.id)
        .order_by(GradeExam.date.desc(), GradeExam.created_at.desc(), GradeExam.id)
    )
    visible = _visible_grade_ids(bindings, year)
    if visible is not None:
        stmt = stmt.where(GradeExam.grade_id.in_(visible))
    if grade_id is not None:
        stmt = stmt.where(GradeExam.grade_id == grade_id)
    return grade_exam_outs(db, db.scalars(stmt).all())


def _lock_class_exams(db: Session, ge: GradeExam) -> list[Exam]:
    return list(
        db.scalars(
            select(Exam)
            .where(Exam.grade_exam_id == ge.id)
            .order_by(Exam.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
    )


def _scored_subjects(db: Session, exam_ids: Sequence[UUID], names: Sequence[str]) -> set[str]:
    """Subjects with at least one entered cell (absent included) in any of the exams."""
    if not exam_ids or not names:
        return set()
    return set(
        db.scalars(
            select(Score.subject)
            .where(Score.exam_id.in_(exam_ids), Score.subject.in_(names))
            .distinct()
        ).all()
    )


def _max_scores(db: Session, exam_ids: Sequence[UUID], names: Sequence[str]) -> dict[str, float]:
    """各科在读学生已录的最高分,整场联考一次聚合查出(L38);没有分数的科目不在结果里。"""
    if not exam_ids or not names:
        return {}
    rows = db.execute(
        select(Score.subject, func.max(Score.value))
        .join(Enrollment, Enrollment.id == Score.enrollment_id)
        .where(
            Score.exam_id.in_(exam_ids),
            Score.subject.in_(names),
            Enrollment.status == "active",
        )
        .group_by(Score.subject)
    ).all()
    return {subject: top for subject, top in rows if top is not None}


def _ensure_unscored(db: Session, exams: Sequence[Exam]) -> None:
    if db.scalar(select(Score.id).where(Score.exam_id.in_([e.id for e in exams])).limit(1)):
        raise ApiError(409, "EXAM_HAS_SCORES", "已有班级录入了成绩,不能删除")


def create(
    db: Session,
    user: User,
    body: GradeExamInput,
    *,
    now: datetime,
    request: Request | None = None,
) -> GradeExamOut:
    grade = get_grade_in_school(db, user.school_id, body.grade_id)
    year = require_active_year(db, user.school_id)
    if grade.academic_year_id != year.id:
        raise ApiError(400, "BAD_REQUEST", "只能给当前学年的年级建联考")
    _ensure_in_catalog(db, grade, body.subjects, set())
    # 先锁班级、再确认学年仍进行中,之后才插联考行(锁序见 _lock_classes / _ensure_year_live)
    classes = _grade_classes(db, user.school_id, year.id, grade.id)
    _lock_classes(db, classes)
    _ensure_year_live(db, year.id)
    ge = GradeExam(
        school_id=user.school_id,
        academic_year_id=year.id,
        grade_id=grade.id,
        name=body.name,
        exam_type=body.exam_type,
        date=body.date,
        subjects=[s.model_dump() for s in body.subjects],
        created_by_user_id=user.id,
        created_at=now,
        updated_at=now,
    )
    db.add(ge)
    db.flush()
    for cls in sorted(classes, key=lambda c: c.id):
        db.add(_new_exam(ge, cls, user.id, now))
        merge_subjects(db, cls, body.subjects)  # 班级行已锁,这里只是追加科目
    record(
        db,
        user_id=user.id,
        action="exam.grade_create",
        success=True,
        object_type="grade_exam",
        object_id=str(ge.id),
        request=request,
        extra={"classes": len(classes)},
    )
    db.commit()
    return grade_exam_out(db, ge)


def update(
    db: Session,
    user: User,
    ge: GradeExam,
    body: GradeExamInput,
    *,
    now: datetime,
    request: Request | None = None,
) -> GradeExamOut:
    """``ge`` must already be locked (get_grade_exam(lock=True)) and permission-checked."""
    if body.grade_id != ge.grade_id:
        raise ApiError(400, "BAD_REQUEST", "联考不能更换年级")
    # 已有联考里不在目录的科目可以保留(编辑时不强制删),但不能新增目录外的
    grade = db.get(Grade, ge.grade_id)
    assert grade is not None
    _ensure_in_catalog(db, grade, body.subjects, {s["name"] for s in ge.subjects})
    exams = _lock_class_exams(db, ge)
    exam_ids = [e.id for e in exams]
    kept = {s.name for s in body.subjects}
    removed = [s["name"] for s in ge.subjects if s["name"] not in kept]
    scored = _scored_subjects(db, exam_ids, removed)
    for name in removed:  # 按联考原有科目顺序,报第一个
        if name in scored:
            raise ApiError(
                409, "EXAM_HAS_SCORES", f"「{name}」已有成绩,不能去掉", {"subject": name}
            )
    # 去科目与降满分被拒同一个码 409 EXAM_HAS_SCORES(契约;L38),details 指出科目
    top = _max_scores(db, exam_ids, [s.name for s in body.subjects])
    for s in body.subjects:
        if s.name in top and s.full < top[s.name]:
            raise ApiError(
                409,
                "EXAM_HAS_SCORES",
                f"「{s.name}」已有成绩,满分不能低于已录入的最高分",
                {"subject": s.name},
            )
    subjects = [s.model_dump() for s in body.subjects]
    ge.name, ge.exam_type, ge.date, ge.subjects = body.name, body.exam_type, body.date, subjects
    ge.updated_at = now
    classes = {
        c.id: c
        for c in db.scalars(
            select(SchoolClass).where(SchoolClass.id.in_([e.class_id for e in exams]))
        )
    }
    for e in sorted(exams, key=lambda e: e.class_id):  # 班级行锁按 id 升序,防死锁
        e.name, e.exam_type, e.date = body.name, body.exam_type, body.date
        e.subjects = [dict(s) for s in subjects]
        e.updated_at = now
        merge_subjects(db, classes[e.class_id], body.subjects)
    record(
        db,
        user_id=user.id,
        action="exam.grade_update",
        success=True,
        object_type="grade_exam",
        object_id=str(ge.id),
        request=request,
    )
    db.commit()
    return grade_exam_out(db, ge)


def delete_grade_exam(
    db: Session, user: User, ge: GradeExam, *, request: Request | None = None
) -> None:
    exams = _lock_class_exams(db, ge)
    if exams:
        _ensure_unscored(db, exams)
    grade_exam_id = str(ge.id)
    db.execute(delete(Exam).where(Exam.grade_exam_id == ge.id))
    db.delete(ge)
    record(
        db,
        user_id=user.id,
        action="exam.grade_delete",
        success=True,
        object_type="grade_exam",
        object_id=grade_exam_id,
        request=request,
        extra={"classes": len(exams)},
    )
    db.commit()


def sync(
    db: Session,
    user: User,
    ge: GradeExam,
    *,
    now: datetime,
    request: Request | None = None,
) -> GradeExamOut:
    missing = _missing_classes(db, ge)
    _lock_classes(db, missing)  # 先锁班级,再确认学年,再插考试行(同 create)
    _ensure_year_live(db, ge.academic_year_id)
    for cls in sorted(missing, key=lambda c: c.id):
        db.add(_new_exam(ge, cls, user.id, now))
        merge_subjects(db, cls, [SubjectFull(**s) for s in ge.subjects])
    record(
        db,
        user_id=user.id,
        action="exam.grade_sync",
        success=True,
        object_type="grade_exam",
        object_id=str(ge.id),
        request=request,
        extra={"created": len(missing)},
    )
    db.commit()
    return grade_exam_out(db, ge)
