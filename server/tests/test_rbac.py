from uuid import UUID, uuid4

from app.rbac.bindings import Binding, Scope, can, covers, load_bindings
from app.rbac.roles import Perm, Role
from tests.factories import bind, make_class, make_user
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
