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
    ATTENDANCE_READ = "attendance.read"
    ATTENDANCE_WRITE = "attendance.write"
    REVIEW_READ = "review.read"
    REVIEW_WRITE = "review.write"
    SEATING_WRITE = "seating.write"
    BOARD_WRITE = "board.write"
    STUDENT_BASIC_WRITE = "student.write_basic"
    EXAM_READ = "exam.read"
    EXAM_WRITE = "exam.write"
    SCORE_WRITE = "score.write"
    SCORE_EXPORT = "score.export"
    STUDENT_MANAGE = "student.manage"
    STUDENT_EXPORT = "student.export"


# Order matches ClassroomSummary.my_perms.
CLASSROOM_PERMS: tuple[Perm, ...] = (
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
)


_LEADERS = frozenset(
    {
        Perm.CLASS_READ,
        Perm.STUDENT_LIST,
        Perm.STUDENT_BASIC,
        Perm.STUDENT_FAMILY,
        Perm.STUDENT_LEARNING,
        Perm.STUDENT_PROFILE,
        Perm.ATTENDANCE_READ,
        Perm.REVIEW_READ,
        Perm.EXAM_READ,
        Perm.SCORE_EXPORT,
        Perm.STUDENT_EXPORT,
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
    Role.homeroom_teacher: frozenset(
        {
            Perm.CLASS_READ,
            Perm.STUDENT_LIST,
            Perm.STUDENT_BASIC,
            Perm.STUDENT_FAMILY,
            Perm.STUDENT_LEARNING,
            Perm.STUDENT_PROFILE,
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
        }
    ),
    Role.subject_teacher: frozenset(
        {
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
        }
    ),
    Role.assistant_teacher: frozenset(
        {
            Perm.CLASS_READ,
            Perm.STUDENT_LIST,
            Perm.STUDENT_BASIC,
            Perm.ATTENDANCE_READ,
            Perm.ATTENDANCE_WRITE,
            Perm.REVIEW_READ,
            Perm.REVIEW_WRITE,
        }
    ),
    Role.primary_parent: _PARENT,
    Role.secondary_parent: _PARENT,
}
