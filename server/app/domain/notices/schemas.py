from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, field_validator


class SchoolTarget(BaseModel):
    kind: Literal["school"]


class GradeTarget(BaseModel):
    kind: Literal["grade"]
    grade_id: UUID


class ClassTarget(BaseModel):
    kind: Literal["class"]
    class_id: UUID


class UsersTarget(BaseModel):
    kind: Literal["users"]
    user_ids: Annotated[list[UUID], Field(min_length=1, max_length=200)]

    @field_validator("user_ids")
    @classmethod
    def _dedupe(cls, value: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(value))


NoticeTarget = Annotated[
    SchoolTarget | GradeTarget | ClassTarget | UsersTarget, Field(discriminator="kind")
]


class NoAck(BaseModel):
    kind: Literal["none"]


class ConfirmAck(BaseModel):
    kind: Literal["confirm"]


AckOption = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]


class ChoiceAck(BaseModel):
    kind: Literal["choice"]
    options: Annotated[list[AckOption], Field(min_length=2, max_length=5)]
    allow_note: bool = False

    @field_validator("options")
    @classmethod
    def _distinct(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("options must be distinct")
        return value


AckSpec = Annotated[NoAck | ConfirmAck | ChoiceAck, Field(discriminator="kind")]
Audience = Literal["teachers", "parents"]


class NoticeInput(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    target: NoticeTarget
    audience: Audience = "teachers"
    ack: AckSpec = NoAck(kind="none")
    ack_deadline: datetime | None = None


class ClassNoticeInput(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
    content: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    ack: AckSpec = NoAck(kind="none")
    ack_deadline: datetime | None = None


class NoticeSent(BaseModel):
    id: UUID
    title: str
    content: str
    target_label: str
    created_at: datetime
    recalled_at: datetime | None
    recipients: int
    read: int
    audience: Audience
    ack: AckSpec
    ack_deadline: datetime | None
    acked: int
    students_without_parent: int


class OptionGrade(BaseModel):
    id: UUID
    name: str


class OptionClass(BaseModel):
    id: UUID
    name: str
    grade_id: UUID


class NoticeOptions(BaseModel):
    school_wide: bool
    grades: list[OptionGrade]
    classes: list[OptionClass]


class AckInput(BaseModel):
    choice: int | None = None
    note: str | None = Field(default=None, max_length=1000)  # 宽松上限;业务上限 200 见 service


class AckRow(BaseModel):
    user_id: UUID
    user_name: str
    student_id: UUID | None
    student_name: str | None
    class_name: str | None
    read_at: datetime | None
    choice: int | None
    note: str | None
    acked_at: datetime | None


class AckStats(BaseModel):
    audience: Audience
    ack: AckSpec
    ack_deadline: datetime | None
    total: int
    read: int
    acked: int
    counts: list[int]
    students_without_parent: int
    rows: list[AckRow]


class MyAck(BaseModel):
    choice: int | None
    note: str | None
    acked_at: datetime


class NoticeSentPage(BaseModel):
    items: list[NoticeSent]
    total: int


class NoticePerson(BaseModel):
    user_id: UUID
    name: str
    tags: list[str]


class ReadRecipient(BaseModel):
    user_id: UUID
    name: str
    read_at: datetime


class UnreadRecipient(BaseModel):
    user_id: UUID
    name: str


class NoticeRecipients(BaseModel):
    read: list[ReadRecipient]
    unread: list[UnreadRecipient]


class StudentDetail(BaseModel):
    name: str
    class_name: str | None  # 发送时刻所在的班(notice_students 快照)


# 不能回执的原因(L88 / L231):撤回 / 已过截止(服务器时间)/ 孩子已毕业或离校(绑定只读)/
# 调用者不是主家长 / 与孩子的关联已结束(绑定 ended 或学生已删,unlinked)
AckBlockReason = Literal["closed", "recalled", "readonly", "not_primary", "unlinked"]


class InboxItem(BaseModel):
    id: UUID
    title: str
    content: str | None
    from_name: str | None
    created_at: datetime
    read_at: datetime | None
    recalled: bool
    ack: AckSpec
    ack_deadline: datetime | None
    my_ack: MyAck | None
    students: list[str]
    students_detail: list[StudentDetail]
    can_ack: bool
    ack_block_reason: AckBlockReason | None  # can_ack 为假时的原因;不需要回执的通知为 null


class Inbox(BaseModel):
    items: list[InboxItem]
    total: int
    unread: int
