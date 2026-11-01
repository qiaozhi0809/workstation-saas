from enum import StrEnum


class Role(StrEnum):
    principal = "principal"
    dean = "dean"
    grade_head = "grade_head"
    it_admin = "it_admin"
    homeroom_teacher = "homeroom_teacher"
    subject_teacher = "subject_teacher"
    assistant_teacher = "assistant_teacher"
    primary_parent = "primary_parent"
    secondary_parent = "secondary_parent"


TEACHER_ROLES = frozenset({Role.homeroom_teacher, Role.subject_teacher, Role.assistant_teacher})


class Perm(StrEnum):
    CLASS_READ = "class.read"
    STUDENT_LIST = "student.list"
    STUDENT_BASIC = "student.read_basic"
    STUDENT_FAMILY = "student.read_family"
    STUDENT_LEARNING = "student.read_learning"
    STUDENT_PROFILE = "student.read_profile"
    TEACHER_NOTES = "student.teacher_notes"


_LEADERS = frozenset(
    {
        Perm.CLASS_READ,
        Perm.STUDENT_LIST,
        Perm.STUDENT_BASIC,
        Perm.STUDENT_FAMILY,
        Perm.STUDENT_LEARNING,
        Perm.STUDENT_PROFILE,
    }
)
_PARENT = frozenset(
    {Perm.STUDENT_BASIC, Perm.STUDENT_FAMILY, Perm.STUDENT_LEARNING, Perm.STUDENT_PROFILE}
)

ROLE_PERMS: dict[Role, frozenset[Perm]] = {
    Role.principal: _LEADERS,
    Role.dean: _LEADERS,
    Role.grade_head: _LEADERS,
    Role.it_admin: frozenset(),
    Role.homeroom_teacher: frozenset(Perm),
    Role.subject_teacher: frozenset(
        {
            Perm.CLASS_READ,
            Perm.STUDENT_LIST,
            Perm.STUDENT_BASIC,
            Perm.STUDENT_LEARNING,
            Perm.STUDENT_PROFILE,
        }
    ),
    Role.assistant_teacher: frozenset({Perm.CLASS_READ, Perm.STUDENT_LIST, Perm.STUDENT_BASIC}),
    Role.primary_parent: _PARENT,
    Role.secondary_parent: _PARENT,
}
