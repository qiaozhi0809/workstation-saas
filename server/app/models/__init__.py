from app.models.ai import AiBatchItem, AiChat, AiMessage
from app.models.audit import AuditLog
from app.models.base import Base
from app.models.classroom import (
    Attendance,
    AttendanceDay,
    ClassBoard,
    Review,
    SeatArrangement,
    Todo,
    UserPreference,
)
from app.models.grades import Exam, Score
from app.models.rbac import RoleBinding
from app.models.records import Comment, GrowthRecord
from app.models.school import AcademicYear, Grade, School, SchoolClass, SchoolSetting
from app.models.student import Enrollment, Student
from app.models.user import User
from app.models.years import YearUpgrade

__all__ = [
    "AcademicYear",
    "AiBatchItem",
    "AiChat",
    "AiMessage",
    "Attendance",
    "AttendanceDay",
    "AuditLog",
    "Base",
    "ClassBoard",
    "Comment",
    "Enrollment",
    "Exam",
    "Grade",
    "GrowthRecord",
    "Review",
    "RoleBinding",
    "School",
    "SchoolClass",
    "SchoolSetting",
    "Score",
    "SeatArrangement",
    "Student",
    "Todo",
    "User",
    "UserPreference",
    "YearUpgrade",
]
