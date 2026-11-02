from uuid import UUID, uuid4

import pytest

from app.errors import ApiError
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
from app.rbac.roles import ROLE_PERMS, Perm, Role
from tests.factories import bind, make_class, make_user
from tests.helpers import audit_rows
from tests.seed_ids import CLASS_ID, TEACHER_USER_ID, YEAR_ID


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
    }
    parent = {Perm.STUDENT_BASIC, Perm.STUDENT_FAMILY, Perm.STUDENT_LEARNING, Perm.STUDENT_PROFILE}
    expected = {
        Role.principal: leaders,
        Role.dean: leaders,
        Role.grade_head: leaders,
        Role.it_admin: set(),
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
        },
        Role.assistant_teacher: {
            Perm.CLASS_READ,
            Perm.STUDENT_LIST,
            Perm.STUDENT_BASIC,
            Perm.ATTENDANCE_READ,
            Perm.ATTENDANCE_WRITE,
            Perm.REVIEW_READ,
            Perm.REVIEW_WRITE,
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
