from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, update

from app.errors import ApiError
from app.models import RoleBinding
from app.rbac.admin import ADMIN_PERM_ORDER, account_admin_count, admin_perms, ensure_admin
from app.rbac.bindings import (
    Binding,
    Scope,
    can,
    covers,
    load_bindings,
    subjects_in_class,
    visible_subjects,
    writable_subjects,
)
from app.rbac.guard import ensure
from app.rbac.roles import ADMIN_ROLES, LEADER_ROLES, ROLE_PERMS, Perm, Role
from tests.factories import bind, make_admin, make_class, make_user
from tests.helpers import audit_rows
from tests.seed_ids import CLASS_ID, GRADE_ID, SCHOOL_ID, TEACHER_USER_ID, YEAR_ID


def b(role, **scope):
    return Binding(role=role, scope=Scope(**scope), academic_year_id=None)


def test_homeroom_own_class_allowed():
    c = uuid4()
    assert can([b(Role.homeroom_teacher, class_id=c)], Perm.STUDENT_LIST, Scope(class_id=c))


def test_homeroom_other_class_denied():
    assert not can(
        [b(Role.homeroom_teacher, class_id=uuid4())], Perm.STUDENT_LIST, Scope(class_id=uuid4())
    )


def test_multi_binding_field_visibility():
    a, c = uuid4(), uuid4()
    bs = [b(Role.homeroom_teacher, class_id=a), b(Role.subject_teacher, class_id=c)]
    assert can(bs, Perm.STUDENT_FAMILY, Scope(class_id=a))
    assert not can(bs, Perm.STUDENT_FAMILY, Scope(class_id=c))
    assert can(bs, Perm.STUDENT_PROFILE, Scope(class_id=c))


def test_grade_head_covers_classes_in_grade_only():
    g = uuid4()
    bs = [b(Role.grade_head, grade_id=g)]
    assert can(bs, Perm.STUDENT_FAMILY, Scope(grade_id=g, class_id=uuid4()))
    assert not can(bs, Perm.STUDENT_FAMILY, Scope(grade_id=uuid4(), class_id=uuid4()))


def test_principal_school_scope():
    s = uuid4()
    assert can(
        [b(Role.principal, school_id=s)],
        Perm.STUDENT_BASIC,
        Scope(school_id=s, grade_id=uuid4(), class_id=uuid4()),
    )


def test_it_admin_has_no_business_data():
    s = uuid4()
    assert not can([b(Role.it_admin, school_id=s)], Perm.STUDENT_BASIC, Scope(school_id=s))


def test_parent_scoped_to_own_child():
    kid = uuid4()
    bs = [b(Role.primary_parent, student_id=kid)]
    assert can(bs, Perm.STUDENT_FAMILY, Scope(class_id=uuid4(), student_id=kid))
    assert not can(bs, Perm.STUDENT_BASIC, Scope(class_id=uuid4(), student_id=uuid4()))


def test_empty_scope_covers_nothing():
    assert not covers(Scope(), Scope(class_id=uuid4()))


def test_load_seed_binding(db):
    bs = load_bindings(db, UUID(TEACHER_USER_ID), UUID(YEAR_ID))
    assert bs == [Binding(Role.homeroom_teacher, Scope(class_id=UUID(CLASS_ID)), UUID(YEAR_ID))]


def test_load_excludes_ended_and_other_year(db):
    u = make_user(db, "t_rbac")
    c = make_class(db, "三年三班")
    bind(db, u.id, Role.subject_teacher, class_id=c, ended=True)
    bind(db, u.id, Role.subject_teacher, class_id=c, year_id=None)
    assert [x.academic_year_id for x in load_bindings(db, u.id, UUID(YEAR_ID))] == [None]
    other_year = uuid4()
    assert len(load_bindings(db, u.id, other_year)) == 1


READ_STUDENTS = {
    Perm.CLASS_READ,
    Perm.STUDENT_LIST,
    Perm.STUDENT_BASIC,
    Perm.STUDENT_FAMILY,
    Perm.STUDENT_LEARNING,
    Perm.STUDENT_PROFILE,
}


def test_role_perms_full_matrix():
    leaders = READ_STUDENTS | {
        Perm.ATTENDANCE_READ,
        Perm.REVIEW_READ,
        Perm.EXAM_READ,
        Perm.SCORE_EXPORT,
        Perm.STUDENT_EXPORT,
        Perm.GROWTH_READ,
        Perm.COMMENT_READ,
    }
    parent = {Perm.STUDENT_BASIC, Perm.STUDENT_FAMILY, Perm.STUDENT_LEARNING, Perm.STUDENT_PROFILE}
    expected = {
        Role.principal: leaders | NEW_PERM_MATRIX[Role.principal],
        Role.dean: leaders | NEW_PERM_MATRIX[Role.dean],
        Role.grade_head: leaders | NEW_PERM_MATRIX[Role.grade_head],
        Role.it_admin: NEW_PERM_MATRIX[Role.it_admin],
        Role.homeroom_teacher: READ_STUDENTS
        | {
            Perm.TEACHER_NOTES,
            Perm.ATTENDANCE_READ,
            Perm.ATTENDANCE_WRITE,
            Perm.REVIEW_READ,
            Perm.REVIEW_WRITE,
            Perm.SEATING_WRITE,
            Perm.BOARD_WRITE,
            Perm.STUDENT_BASIC_WRITE,
            Perm.EXAM_READ,
            Perm.EXAM_WRITE,
            Perm.SCORE_WRITE,
            Perm.SCORE_EXPORT,
            Perm.STUDENT_MANAGE,
            Perm.STUDENT_EXPORT,
            Perm.GROWTH_READ,
            Perm.GROWTH_WRITE,
            Perm.COMMENT_READ,
            Perm.COMMENT_WRITE,
            Perm.AI_USE,
            Perm.AI_CLASS,
        },
        Role.subject_teacher: {
            Perm.CLASS_READ,
            Perm.STUDENT_LIST,
            Perm.STUDENT_BASIC,
            Perm.STUDENT_LEARNING,
            Perm.STUDENT_PROFILE,
            Perm.ATTENDANCE_READ,
            Perm.REVIEW_READ,
            Perm.REVIEW_WRITE,
            Perm.EXAM_READ,
            Perm.EXAM_WRITE,
            Perm.SCORE_WRITE,
            Perm.GROWTH_READ,
            Perm.AI_USE,
        },
        Role.assistant_teacher: {
            Perm.CLASS_READ,
            Perm.STUDENT_LIST,
            Perm.STUDENT_BASIC,
            Perm.ATTENDANCE_READ,
            Perm.ATTENDANCE_WRITE,
            Perm.REVIEW_READ,
            Perm.REVIEW_WRITE,
            Perm.GROWTH_READ,
            Perm.GROWTH_WRITE,
            Perm.AI_USE,
        },
        Role.primary_parent: parent,
        Role.secondary_parent: parent,
    }
    assert set(ROLE_PERMS) == set(Role)
    for role in Role:
        assert set(ROLE_PERMS[role]) == expected[role], role
    assert set().union(*expected.values()) == set(Perm)


def test_subject_is_loaded_from_scope(db):
    u = make_user(db, "t_physics")
    bind(db, u.id, Role.subject_teacher, class_id=CLASS_ID, subject="物理")
    [binding] = load_bindings(db, u.id, UUID(YEAR_ID))
    assert binding.subject == "物理"


def test_subjects_in_class_only_counts_subject_bindings():
    c = UUID(CLASS_ID)
    bs = [
        Binding(Role.subject_teacher, Scope(class_id=c), None, "数学"),
        Binding(Role.subject_teacher, Scope(class_id=c), None, "科学"),
        Binding(Role.subject_teacher, Scope(class_id=uuid4()), None, "英语"),
        Binding(Role.homeroom_teacher, Scope(class_id=c), None, "语文"),
    ]
    assert subjects_in_class(bs, c) == ["数学", "科学"]


def test_ensure_denies_with_perm_as_action(db):
    u = make_user(db, "t_guard")
    with pytest.raises(ApiError) as exc:
        ensure(
            db,
            None,
            u.id,
            [],
            Perm.SEATING_WRITE,
            Scope(class_id=UUID(CLASS_ID)),
            object_id=CLASS_ID,
        )
    assert exc.value.code == "FORBIDDEN"
    rows = audit_rows(db, CLASS_ID)
    assert [(r.action, r.success, r.user_id) for r in rows] == [("seating.write", False, u.id)]


def test_visible_subjects():
    c = uuid4()
    scope = Scope(class_id=c)
    math = Binding(Role.subject_teacher, Scope(class_id=c), None, "数学")
    assert visible_subjects([b(Role.homeroom_teacher, class_id=c)], scope) is None
    assert visible_subjects([math], scope) == frozenset({"数学"})
    sid = uuid4()
    school_scope = Scope(school_id=sid, class_id=c)
    assert visible_subjects([b(Role.principal, school_id=sid)], school_scope) is None
    other = Binding(Role.subject_teacher, Scope(class_id=uuid4()), None, "数学")
    assert visible_subjects([other], scope) == frozenset()
    assert writable_subjects([math], scope) == frozenset({"数学"})
    assert writable_subjects([b(Role.homeroom_teacher, class_id=c)], scope) is None


NEW_PERMS = (
    Perm.ORG_MANAGE,
    Perm.ACCOUNT_MANAGE,
    Perm.SETTINGS_MANAGE,
    Perm.AUDIT_READ,
    Perm.AI_USAGE,
    Perm.NOTICE_SEND,
    Perm.GRADE_EXAM_WRITE,
    Perm.YEAR_UPGRADE,
)
# 范围清单"权限矩阵(M3 新增)":每个角色 × 每个新权限点
NEW_PERM_MATRIX = {
    Role.principal: set(NEW_PERMS),
    Role.dean: {
        Perm.ORG_MANAGE,
        Perm.AI_USAGE,
        Perm.NOTICE_SEND,
        Perm.GRADE_EXAM_WRITE,
        Perm.YEAR_UPGRADE,
    },
    Role.grade_head: {Perm.NOTICE_SEND, Perm.GRADE_EXAM_WRITE},
    Role.it_admin: {Perm.ORG_MANAGE, Perm.ACCOUNT_MANAGE, Perm.SETTINGS_MANAGE, Perm.AUDIT_READ},
}


@pytest.mark.parametrize("role", list(Role))
@pytest.mark.parametrize("perm", NEW_PERMS)
def test_new_perm_matrix(role, perm):
    assert (perm in ROLE_PERMS[role]) == (perm in NEW_PERM_MATRIX.get(role, set()))


def test_new_perm_values_and_role_sets():
    assert [p.value for p in NEW_PERMS] == [
        "org.manage",
        "account.manage",
        "settings.manage",
        "audit.read",
        "ai.usage",
        "notice.send",
        "exam.grade_write",
        "year.upgrade",
    ]
    assert ADMIN_ROLES == {Role.principal, Role.dean, Role.grade_head, Role.it_admin}
    assert LEADER_ROLES == {Role.principal, Role.dean, Role.grade_head}


def test_admin_perms_order_and_school_view():
    s = uuid4()
    assert ADMIN_PERM_ORDER[0] == "school.view"
    assert admin_perms([b(Role.principal, school_id=s)]) == list(ADMIN_PERM_ORDER)
    assert len(ADMIN_PERM_ORDER) == 9
    assert admin_perms([b(Role.it_admin, school_id=s)]) == [
        "org.manage",
        "account.manage",
        "settings.manage",
        "audit.read",
    ]
    assert admin_perms([b(Role.homeroom_teacher, class_id=uuid4())]) == []
    assert admin_perms([b(Role.grade_head, grade_id=uuid4())]) == [
        "school.view",
        "notice.send",
        "exam.grade_write",
    ]


def test_grade_head_scope(db):
    u = make_user(db, "t_gh")
    g4 = uuid4()
    bs = [b(Role.grade_head, grade_id=UUID(GRADE_ID))]
    sid = UUID(SCHOOL_ID)
    ensure_admin(db, None, u.id, bs, Perm.NOTICE_SEND, sid, grade_id=UUID(GRADE_ID))
    with pytest.raises(ApiError) as exc:
        ensure_admin(db, None, u.id, bs, Perm.NOTICE_SEND, sid, grade_id=g4)
    assert exc.value.code == "FORBIDDEN"
    with pytest.raises(ApiError):
        ensure_admin(db, None, u.id, bs, Perm.NOTICE_SEND, sid)
    rows = audit_rows(db, sid)
    assert [(r.action, r.object_type, r.success) for r in rows] == [
        ("notice.send", "school", False),
        ("notice.send", "school", False),
    ]


def test_ensure_admin_principal_school_scope(db):
    u = make_user(db, "t_pr")
    sid = UUID(SCHOOL_ID)
    ensure_admin(db, None, u.id, [b(Role.principal, school_id=sid)], Perm.ORG_MANAGE, sid)


def test_account_admin_count(db):
    base = account_admin_count(db, UUID(SCHOOL_ID))
    p = make_admin(db, None, "principal")
    it = make_admin(db, None, "it_admin")
    make_admin(db, None, "dean")
    assert account_admin_count(db, UUID(SCHOOL_ID)) == base + 2
    pid = db.scalars(
        select(RoleBinding.id).where(
            RoleBinding.user_id == p.id, RoleBinding.role_type == "principal"
        )
    ).one()
    assert account_admin_count(db, UUID(SCHOOL_ID), excluding_binding=pid) == base + 1
    it.status = "frozen"
    db.flush()
    assert account_admin_count(db, UUID(SCHOOL_ID)) == base + 1
    db.execute(update(RoleBinding).where(RoleBinding.user_id == p.id).values(ended_at=func.now()))
    assert account_admin_count(db, UUID(SCHOOL_ID)) == base
