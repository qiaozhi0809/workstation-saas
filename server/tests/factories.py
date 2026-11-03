from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.passwords import hash_password
from app.models import Enrollment, RoleBinding, SchoolClass, Student, User
from app.rbac.roles import Role
from tests.seed_ids import GRADE_ID, SCHOOL_ID, YEAR_ID


def make_user(db: Session, login_name: str, display_name: str = "测试老师") -> User:
    user = User(
        school_id=UUID(SCHOOL_ID),
        login_name=login_name,
        password_hash=hash_password("dev123"),
        display_name=display_name,
    )
    db.add(user)
    db.flush()
    return user


def _uuid_or_none(value: str | UUID | None) -> str | None:
    return None if value is None else str(value)


def bind(
    db: Session,
    user_id: UUID,
    role: Role,
    *,
    class_id: str | UUID | None = None,
    grade_id: str | UUID | None = None,
    school_id: str | UUID | None = None,
    student_id: str | UUID | None = None,
    subject: str | None = None,
    year_id: str | UUID | None = YEAR_ID,
    ended: bool = False,
) -> None:
    scope = {
        "class_id": _uuid_or_none(class_id),
        "grade_id": _uuid_or_none(grade_id),
        "school_id": _uuid_or_none(school_id),
        "student_id": _uuid_or_none(student_id),
        "subject": subject,
    }
    db.add(
        RoleBinding(
            user_id=user_id,
            role_type=role.value,
            scope={k: v for k, v in scope.items() if v is not None},
            academic_year_id=None if year_id is None else UUID(str(year_id)),
            ended_at=datetime.now(UTC) if ended else None,
        )
    )
    db.flush()


def make_class(
    db: Session,
    name: str,
    *,
    grade_id: str | UUID = GRADE_ID,
    year_id: str | UUID = YEAR_ID,
    seat_rows: int = 6,
    seat_cols: int = 4,
    desk_size: int = 2,
    seat_layout: str = "manual",
    seat_order: str = "row",
    podium_left: int = 0,
    podium_right: int = 0,
) -> UUID:
    cls = SchoolClass(
        school_id=UUID(SCHOOL_ID),
        academic_year_id=UUID(str(year_id)),
        grade_id=UUID(str(grade_id)),
        name=name,
        seat_rows=seat_rows,
        seat_cols=seat_cols,
        desk_size=desk_size,
        seat_layout=seat_layout,
        seat_order=seat_order,
        podium_left=podium_left,
        podium_right=podium_right,
    )
    db.add(cls)
    db.flush()
    return cls.id


def make_student(
    db: Session,
    class_id: UUID,
    name: str,
    mk: str,
    *,
    year_id: str | UUID = YEAR_ID,
    **fields,
) -> UUID:
    student = Student(school_id=UUID(SCHOOL_ID), name=name, mk=mk, **fields)
    db.add(student)
    db.flush()
    db.add(
        Enrollment(
            student_id=student.id,
            class_id=class_id,
            academic_year_id=UUID(str(year_id)),
        )
    )
    db.flush()
    return student.id


def make_teacher_account(
    db: Session, school: str | UUID | None = None, login_name: str | None = None
) -> User:
    user = make_user(db, login_name or f"t_{uuid4().hex[:8]}")
    if school is not None:
        user.school_id = UUID(str(school))
    db.execute(text("INSERT INTO teachers (user_id) VALUES (:uid)"), {"uid": user.id})
    db.flush()
    return user


def make_admin(
    db: Session,
    school: str | UUID | None,
    role: str,
    *,
    grade: str | UUID | None = None,
) -> User:
    """管理岗账号:校长 / 教导主任 / 信息中心绑学校作用域(不限学年),年级组长绑年级(当前学年)。"""
    school_id = SCHOOL_ID if school is None else school
    user = make_teacher_account(db, school_id)
    if role == Role.grade_head.value:
        bind(db, user.id, Role.grade_head, grade_id=grade or GRADE_ID)
    else:
        bind(db, user.id, Role(role), school_id=school_id, year_id=None)
    return user
