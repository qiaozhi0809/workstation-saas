from app.models.ai import AiBatchItem, AiChat, AiMessage
from app.models.audit import AuditLog
from app.models.base import Base
from app.models.cameras import Camera
from app.models.classroom import (
    Attendance,
    AttendanceDay,
    ClassBoard,
    Review,
    SeatArrangement,
    Todo,
    UserPreference,
)
from app.models.grades import Exam, GradeExam, Score
from app.models.login_logs import LoginLog
from app.models.notices import Notice, NoticeRecipient, NoticeStudent
from app.models.parents import Parent, ParentLink
from app.models.rbac import RoleBinding
from app.models.records import Comment, GrowthRecord
from app.models.school import AcademicYear, Grade, School, SchoolClass, SchoolSetting
from app.models.student import Enrollment, Student
from app.models.timetable import Period, TimetableEntry
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
    "Camera",
    "ClassBoard",
    "Comment",
    "Enrollment",
    "Exam",
    "Grade",
    "GradeExam",
    "GrowthRecord",
    "LoginLog",
    "Notice",
    "NoticeRecipient",
    "NoticeStudent",
    "Parent",
    "ParentLink",
    "Period",
    "Review",
    "RoleBinding",
    "School",
    "SchoolClass",
    "SchoolSetting",
    "Score",
    "SeatArrangement",
    "Student",
    "TimetableEntry",
    "Todo",
    "User",
    "UserPreference",
    "YearUpgrade",
]
