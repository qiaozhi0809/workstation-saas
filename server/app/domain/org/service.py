from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from uuid import UUID

from fastapi import Request
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit.service import record
from app.domain.classes.sort import class_sort_key
from app.domain.exams.subjects import STAGE_KEY, stage_of
from app.domain.org.schemas import (
    ClassAdmin,
    ClassInput,
    GradeAdmin,
    GradeInput,
    PersonBrief,
    SchoolInfo,
    StaffBrief,
    SubjectTeachers,
    YearAdmin,
    YearUpdate,
)
from app.domain.years.locks import ensure_year_live
from app.errors import ApiError
from app.models import AcademicYear, Grade, RoleBinding, School, SchoolClass

_STAGE_LABEL = {v: k for k, v in STAGE_KEY.items()}

# 班级下这些表有数据就不能删(enrollments 含已离班的)
_CLASS_DATA_TABLES = (
    "enrollments",
    "attendances",
    "attendance_days",
    "reviews",
    "exams",
    "growth_records",
    "comments",
    "ai_chats",
)


def get_school(db: Session, school_id: UUID) -> SchoolInfo:
    school = db.get(School, school_id)
    assert school is not None
    return SchoolInfo(name=school.name, address=school.address)


def save_school(
    db: Session, school_id: UUID, body: SchoolInfo, user_id: UUID, request: Request | None
) -> SchoolInfo:
    school = db.get(School, school_id)
    assert school is not None
    school.name = body.name
    school.address = body.address or None
    record(
        db,
        user_id=user_id,
        action="org.school",
        success=True,
        object_type="school",
        object_id=str(school_id),
        request=request,
    )
    db.commit()
    return get_school(db, school_id)


def _year_out(y: AcademicYear) -> YearAdmin:
    return YearAdmin(
        id=y.id,
        name=y.name,
        start_date=y.start_date,
        end_date=y.end_date,
        term2_start=y.term2_start,
        is_active=y.is_active,
    )


def list_years(db: Session, school_id: UUID) -> list[YearAdmin]:
    rows = db.scalars(
        select(AcademicYear)
        .where(AcademicYear.school_id == school_id)
        .order_by(AcademicYear.is_active.desc(), AcademicYear.start_date.desc())
    ).all()
    return [_year_out(y) for y in rows]


def update_year(
    db: Session,
    school_id: UUID,
    year_id: UUID,
    body: YearUpdate,
    user_id: UUID,
    request: Request | None,
) -> YearAdmin:
    year = db.get(AcademicYear, year_id)
    if year is None or year.school_id != school_id:
        raise ApiError(404, "NOT_FOUND", "学年不存在")
    if body.start_date >= body.end_date:
        raise ApiError(400, "BAD_REQUEST", "开学日期必须早于结束日期")
    if body.term2_start is not None and not (body.start_date < body.term2_start < body.end_date):
        raise ApiError(400, "BAD_REQUEST", "第二学期开始日期必须在学年起止日期之间")
    year.name = body.name
    year.start_date = body.start_date
    year.end_date = body.end_date
    year.term2_start = body.term2_start
    record(
        db,
        user_id=user_id,
        action="org.year",
        success=True,
        object_type="academic_year",
        object_id=str(year_id),
        request=request,
    )
    db.commit()
    return _year_out(year)


def _grade_out(grade: Grade, class_count: int) -> GradeAdmin:
    return GradeAdmin(
        id=grade.id,
        name=grade.name,
        stage=grade.stage,
        effective_stage=grade.stage or _STAGE_LABEL[stage_of(grade.name)],
        display_order=grade.display_order,
        class_count=class_count,
    )


def _class_count(db: Session, grade_id: UUID) -> int:
    return (
        db.scalar(
            select(func.count()).select_from(SchoolClass).where(SchoolClass.grade_id == grade_id)
        )
        or 0
    )


def list_grades(db: Session, school_id: UUID, year_id: UUID) -> list[GradeAdmin]:
    counts = dict(
        db.execute(
            select(SchoolClass.grade_id, func.count())
            .where(SchoolClass.academic_year_id == year_id)
            .group_by(SchoolClass.grade_id)
        ).all()
    )
    grades = db.scalars(
        select(Grade)
        .where(Grade.school_id == school_id, Grade.academic_year_id == year_id)
        .order_by(Grade.display_order, Grade.name)
    ).all()
    return [_grade_out(g, counts.get(g.id, 0)) for g in grades]


def get_grade(db: Session, school_id: UUID, grade_id: UUID) -> Grade:
    grade = db.get(Grade, grade_id)
    if grade is None or grade.school_id != school_id:
        raise ApiError(404, "NOT_FOUND", "年级不存在")
    return grade


def _name_taken(db: Session, year_id: UUID, name: str, exclude: UUID | None) -> bool:
    stmt = select(Grade.id).where(Grade.academic_year_id == year_id, Grade.name == name)
    if exclude is not None:
        stmt = stmt.where(Grade.id != exclude)
    return db.scalars(stmt).first() is not None


def create_grade(
    db: Session,
    school_id: UUID,
    year_id: UUID,
    body: GradeInput,
    user_id: UUID,
    request: Request | None,
) -> GradeAdmin:
    if _name_taken(db, year_id, body.name, None):
        raise ApiError(409, "NAME_TAKEN", "该年级名称已存在")
    ensure_year_live(db, year_id)  # 学年刚被回滚 → 409,而不是插入撞学年外键 500(L261)
    grade = Grade(
        school_id=school_id,
        academic_year_id=year_id,
        name=body.name,
        stage=body.stage,
        display_order=body.display_order,
    )
    db.add(grade)
    db.flush()
    record(
        db,
        user_id=user_id,
        action="org.grade_create",
        success=True,
        object_type="grade",
        object_id=str(grade.id),
        request=request,
        extra={"name": grade.name},
    )
    db.commit()
    return _grade_out(grade, 0)


def update_grade(
    db: Session,
    school_id: UUID,
    grade_id: UUID,
    body: GradeInput,
    user_id: UUID,
    request: Request | None,
) -> GradeAdmin:
    grade = get_grade(db, school_id, grade_id)
    if _name_taken(db, grade.academic_year_id, body.name, grade.id):
        raise ApiError(409, "NAME_TAKEN", "该年级名称已存在")
    grade.name = body.name
    grade.stage = body.stage
    grade.display_order = body.display_order
    record(
        db,
        user_id=user_id,
        action="org.grade_update",
        success=True,
        object_type="grade",
        object_id=str(grade.id),
        request=request,
        extra={"name": grade.name},
    )
    db.commit()
    return _grade_out(grade, _class_count(db, grade.id))


def delete_grade(
    db: Session,
    school_id: UUID,
    grade_id: UUID,
    user_id: UUID,
    now: datetime,
    request: Request | None,
) -> None:
    grade = get_grade(db, school_id, grade_id)
    # 先学年行 KEY SHARE、再年级行 FOR UPDATE(L261,与建班同序):下面要改该年级的组长绑定再删
    # 年级,而回滚持学年 FOR UPDATE 后也是先删绑定、再删年级——不先排在学年锁上,两边会在绑定行与
    # 年级行上互等(40P01)。学年刚被回滚 → 409;学年锁到手后年级已被回滚删掉 → 404。
    ensure_year_live(db, grade.academic_year_id)
    lock_grade(db, grade.id)  # 与建班串行:判"没有班"到删除之间不会有新班插进来
    if _class_count(db, grade.id) > 0:
        raise ApiError(409, "GRADE_NOT_EMPTY", "该年级下还有班级,不能删除")
    # 该年级的年级组长绑定随年级一并结束,避免悬空
    for bd in db.scalars(
        select(RoleBinding).where(
            RoleBinding.role_type == "grade_head",
            RoleBinding.ended_at.is_(None),
            RoleBinding.scope["grade_id"].astext == str(grade.id),
        )
    ):
        bd.ended_at = now
    record(
        db,
        user_id=user_id,
        action="org.grade_delete",
        success=True,
        object_type="grade",
        object_id=str(grade.id),
        request=request,
        extra={"name": grade.name},
    )
    db.delete(grade)
    db.commit()


def _brief_rows(db: Session, class_ids: list[UUID]):
    return db.execute(
        text(
            "SELECT ta.id AS assignment_id, ta.class_id, ta.identity, ta.subject,"
            " ta.teacher_id, u.id AS user_id, u.display_name"
            " FROM teacher_assignments ta"
            " JOIN teachers t ON t.id = ta.teacher_id JOIN users u ON u.id = t.user_id"
            " WHERE ta.class_id = ANY(:ids) AND ta.ended_at IS NULL"
            " ORDER BY ta.started_at, ta.id"
        ),
        {"ids": class_ids},
    ).all()


def _class_outs(db: Session, classes: list[SchoolClass]) -> list[ClassAdmin]:
    if not classes:
        return []
    ids = [c.id for c in classes]
    grades = {
        g.id: g
        for g in db.scalars(select(Grade).where(Grade.id.in_({c.grade_id for c in classes})))
    }
    counts = dict(
        db.execute(
            text(
                "SELECT class_id, count(*) FROM enrollments"
                " WHERE class_id = ANY(:ids) AND status = 'active' GROUP BY class_id"
            ),
            {"ids": ids},
        ).all()
    )
    homeroom: dict[UUID, StaffBrief] = {}
    assistants: dict[UUID, list[StaffBrief]] = {}
    subjects: dict[UUID, dict[str, list[StaffBrief]]] = {}
    for r in _brief_rows(db, ids):
        brief = StaffBrief(
            assignment_id=r.assignment_id,
            user_id=r.user_id,
            teacher_id=r.teacher_id,
            display_name=r.display_name,
        )
        if r.identity == "homeroom":
            homeroom[r.class_id] = brief
        elif r.identity == "assistant":
            assistants.setdefault(r.class_id, []).append(brief)
        elif r.subject:
            subjects.setdefault(r.class_id, {}).setdefault(r.subject, []).append(brief)
    return [
        ClassAdmin(
            id=c.id,
            name=c.name,
            grade_id=c.grade_id,
            grade_name=grades[c.grade_id].name,
            room=c.room,
            student_count=counts.get(c.id, 0),
            homeroom=homeroom.get(c.id),
            assistants=assistants.get(c.id, []),
            subjects=[
                SubjectTeachers(subject=s, teachers=t)
                for s, t in sorted(subjects.get(c.id, {}).items())
            ],
            desk_size=c.desk_size,
            seat_layout=c.seat_layout,
            seat_rows=c.seat_rows,
            seat_cols=c.seat_cols,
            podium_left=c.podium_left,
            podium_right=c.podium_right,
        )
        for c in classes
    ]


def class_admin(db: Session, cls: SchoolClass) -> ClassAdmin:
    return _class_outs(db, [cls])[0]


def list_classes(
    db: Session, school_id: UUID, year_id: UUID, grade_id: UUID | None
) -> list[ClassAdmin]:
    stmt = (
        select(SchoolClass, Grade.display_order)
        .join(Grade, Grade.id == SchoolClass.grade_id)
        .where(
            SchoolClass.school_id == school_id,
            SchoolClass.academic_year_id == year_id,
            SchoolClass.active.is_(True),
        )
    )
    if grade_id is not None:
        stmt = stmt.where(SchoolClass.grade_id == grade_id)
    # 年级按 display_order,同年级班名按数值排(三年二班 < 三年三班 < 三年十班,L40)
    rows = sorted(
        db.execute(stmt).all(), key=lambda r: (r[1], class_sort_key(r[0].name), str(r[0].id))
    )
    return _class_outs(db, [cls for cls, _ in rows])


def get_class(db: Session, school_id: UUID, year_id: UUID, class_id: UUID) -> SchoolClass:
    cls = db.get(SchoolClass, class_id)
    if cls is None or cls.school_id != school_id or cls.academic_year_id != year_id:
        raise ApiError(404, "NOT_FOUND", "班级不存在")
    return cls


def _class_name_taken(db: Session, grade_id: UUID, name: str, exclude: UUID | None) -> bool:
    stmt = select(SchoolClass.id).where(SchoolClass.grade_id == grade_id, SchoolClass.name == name)
    if exclude is not None:
        stmt = stmt.where(SchoolClass.id != exclude)
    return db.scalars(stmt).first() is not None


# 同年级班名唯一索引的名字,以 ORM 声明(models/school.py)为唯一来源,避免两处字面量
_CLASS_NAME_INDEX = next(ix.name for ix in SchoolClass.__table__.indexes if ix.unique)


@contextmanager
def _class_name_guard(db: Session) -> Iterator[None]:
    """应用层重名检查之外的最后一道防线(L263):两个会话并发建 / 改成同一班名时各自都看不见对方
    未提交的行,唯一索引 uq_classes_grade_name 拦下后提交的一方 → 与应用层检查同一个码 409
    NAME_TAKEN,不是 500。"""
    try:
        yield
    except IntegrityError as exc:
        diag = getattr(exc.orig, "diag", None)
        if getattr(diag, "constraint_name", None) != _CLASS_NAME_INDEX:
            raise
        db.rollback()
        raise ApiError(409, "NAME_TAKEN", "该年级下已有同名班级") from exc


def create_class(
    db: Session,
    school_id: UUID,
    year_id: UUID,
    body: ClassInput,
    user_id: UUID,
    request: Request | None,
) -> ClassAdmin:
    grade = get_grade(db, school_id, body.grade_id)
    if grade.academic_year_id != year_id:
        raise ApiError(400, "BAD_REQUEST", "只能在当前学年的年级下建班")
    # 先学年行 KEY SHARE、再年级行 FOR UPDATE、最后插入(L261):学年刚被回滚 → 409 而不是外键 500;
    # 年级正在被删 → 等它提交后 404。顺序与回滚"学年 FOR UPDATE → DELETE grades"一致,不互等。
    ensure_year_live(db, year_id)
    lock_grade(db, grade.id)
    # 重名检查放在年级行锁之后:同年级并发建班在锁上排队,后到的能看见先到的已提交的行,
    # 唯一索引 uq_classes_grade_name 只是最后防线(L263)
    if _class_name_taken(db, grade.id, body.name, None):
        raise ApiError(409, "NAME_TAKEN", "该年级下已有同名班级")
    cls = SchoolClass(
        school_id=school_id,
        academic_year_id=year_id,
        grade_id=grade.id,
        name=body.name,
        room=body.room,
        desk_size=2,
        seat_layout="auto",
        seat_rows=6,
        seat_cols=8,
    )
    with _class_name_guard(db):
        db.add(cls)
        db.flush()
        record(
            db,
            user_id=user_id,
            action="org.class_create",
            success=True,
            object_type="class",
            object_id=str(cls.id),
            request=request,
            extra={"name": cls.name, "grade_id": str(grade.id)},
        )
        db.commit()
    return class_admin(db, cls)


def update_class(
    db: Session,
    school_id: UUID,
    cls: SchoolClass,
    body: ClassInput,
    user_id: UUID,
    request: Request | None,
) -> ClassAdmin:
    lock_class(db, cls)  # 与删班 / 任命 / 学年升级串行;已被并发删除或停用的班 404(L52)
    grade = get_grade(db, school_id, body.grade_id)
    if grade.academic_year_id != cls.academic_year_id:
        raise ApiError(400, "BAD_REQUEST", "只能换到当前学年的年级")
    if grade.id != cls.grade_id:
        # 换年级:先班级行(上面)、再目标年级行 FOR UPDATE,与回滚"班级 → 年级"同序;目标年级
        # 正在被删 → 等它提交后 404,而不是 UPDATE 撞年级外键 500(L261)
        lock_grade(db, grade.id)
    if _class_name_taken(db, grade.id, body.name, cls.id):
        raise ApiError(409, "NAME_TAKEN", "该年级下已有同名班级")
    cls.grade_id = grade.id
    cls.name = body.name
    cls.room = body.room
    with _class_name_guard(db):
        record(
            db,
            user_id=user_id,
            action="org.class_update",
            success=True,
            object_type="class",
            object_id=str(cls.id),
            request=request,
            extra={"name": cls.name, "grade_id": str(grade.id)},
        )
        db.commit()
    return class_admin(db, cls)


def lock_grade(db: Session, grade_id: UUID) -> None:
    """锁住年级行直到事务结束:建班与删年级因此串行(L261)。年级已被并发删掉 → 404。"""
    found = db.execute(
        text("SELECT id FROM grades WHERE id = :g FOR UPDATE"), {"g": grade_id}
    ).first()
    if found is None:
        raise ApiError(404, "NOT_FOUND", "年级不存在")


def lock_class(db: Session, cls: SchoolClass) -> None:
    """锁住班级行直到事务结束:任命班主任与删班因此串行。
    锁拿到后班级行可能已被并发改动,ORM 对象刷新到最新;班级已被并发删除、或已被学年升级
    停用(升级持有全部在读班的锁,排在它后面的写入拿到锁时这个班已是往年的班)都按不存在处理。"""
    found = db.execute(
        text("SELECT id FROM classes WHERE id = :c FOR UPDATE"), {"c": cls.id}
    ).first()
    if found is None:
        raise ApiError(404, "NOT_FOUND", "班级不存在")
    db.refresh(cls)
    if not cls.active:
        raise ApiError(404, "NOT_FOUND", "班级不存在")


def delete_class(
    db: Session, cls: SchoolClass, user_id: UUID, now: datetime, request: Request | None
) -> None:
    lock_class(db, cls)
    for table in _CLASS_DATA_TABLES:
        found = db.execute(
            text(f"SELECT 1 FROM {table} WHERE class_id = :c LIMIT 1"), {"c": cls.id}
        ).first()
        if found:
            raise ApiError(409, "CLASS_NOT_EMPTY", "该班级已有学生或业务数据,不能删除")
    # 班级删除后任职行随外键级联消失,绑定没有外键,必须在这里结束
    for bd in db.scalars(
        select(RoleBinding).where(
            RoleBinding.ended_at.is_(None), RoleBinding.scope["class_id"].astext == str(cls.id)
        )
    ):
        bd.ended_at = now
    record(
        db,
        user_id=user_id,
        action="org.class_delete",
        success=True,
        object_type="class",
        object_id=str(cls.id),
        request=request,
        extra={"name": cls.name},
    )
    db.delete(cls)
    db.commit()


PEOPLE_LIMIT = 20


def list_people(db: Session, school_id: UUID, q: str | None) -> list[PersonBrief]:
    """本校在职教师(有 teachers 行且 active),供任命选人;q 按姓名/登录名包含匹配。"""
    sql = (
        "SELECT u.id, u.display_name, u.login_name, t.subjects, t.id FROM users u "
        "JOIN teachers t ON t.user_id = u.id "
        "WHERE u.school_id = :sid AND u.status = 'active'"
    )
    params: dict[str, object] = {"sid": school_id, "lim": PEOPLE_LIMIT}
    kw = (q or "").strip()
    if kw:
        sql += " AND (u.display_name ILIKE :kw ESCAPE '\\' OR u.login_name ILIKE :kw ESCAPE '\\')"
        esc = kw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params["kw"] = f"%{esc}%"
    sql += " ORDER BY u.display_name, u.login_name LIMIT :lim"
    rows = db.execute(text(sql), params).all()
    return [
        PersonBrief(
            user_id=r[0], teacher_id=r[4], name=r[1], login_name=r[2], subjects=list(r[3] or [])
        )
        for r in rows
    ]
