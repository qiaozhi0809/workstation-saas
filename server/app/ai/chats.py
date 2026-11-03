"""AI 对话的增删查(生成流程见 gateway.py)。"""

from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.requests import Resolved
from app.domain.ai.schemas import (
    AiBatchItemOut,
    AiChatOut,
    AiChatSummaryOut,
    AiMessageOut,
)
from app.errors import ApiError
from app.models import AiBatchItem, AiChat, AiMessage, SchoolClass, Student, User

STALE_AFTER = timedelta(minutes=2)
INTERRUPTED = "上次生成被中断了,可以点「重新生成」"
LIST_LIMIT = 20


def create_chat(db: Session, user: User, cls: SchoolClass, r: Resolved) -> AiChat:
    chat = AiChat(
        user_id=user.id,
        class_id=cls.id,
        template_id=r.template.id if r.template else None,
        title=r.title,
        student_id=r.student_id,
        params=r.params,
        save_as=r.save_as,
        mask=r.masked,
        batch_only=r.batch_only,
    )
    db.add(chat)
    db.flush()
    db.add(
        AiMessage(
            chat_id=chat.id,
            role="user",
            content=r.show,
            sent=None if r.batch_only else r.jobs[0].sent,
            status="done",
        )
    )
    if r.batch_only:
        for pos, job in enumerate(r.jobs):
            assert job.student_id is not None and job.enrollment_id is not None
            db.add(
                AiBatchItem(
                    chat_id=chat.id,
                    position=pos,
                    student_id=job.student_id,
                    enrollment_id=job.enrollment_id,
                    note=job.note,
                    status="wait",
                )
            )
    db.commit()
    return chat


def get_own_chat(db: Session, user_id: UUID, chat_id: UUID) -> AiChat:
    chat = db.get(AiChat, chat_id)
    if chat is None or chat.user_id != user_id:
        raise ApiError(404, "NOT_FOUND", "对话不存在")
    return chat


def ordered_messages(db: Session, chat_id: UUID) -> list[AiMessage]:
    return list(
        db.scalars(
            select(AiMessage)
            .where(AiMessage.chat_id == chat_id)
            .order_by(AiMessage.created_at, AiMessage.id)
        )
    )


def chat_items(db: Session, chat_id: UUID) -> list[AiBatchItem]:
    return list(
        db.scalars(
            select(AiBatchItem).where(AiBatchItem.chat_id == chat_id).order_by(AiBatchItem.position)
        )
    )


def _stale(updated_at: datetime, now: datetime) -> bool:
    return now - updated_at > STALE_AFTER


def item_status(item: AiBatchItem, now: datetime) -> str:
    """显示用状态:超过 2 分钟还在 run 的算 wait。"""
    return "wait" if item.status == "run" and _stale(item.updated_at, now) else item.status


def chat_out(db: Session, chat: AiChat, now: datetime) -> AiChatOut:
    messages = []
    for m in ordered_messages(db, chat.id):
        status, error = m.status, m.error
        if status == "streaming" and _stale(m.updated_at, now):
            status, error = "error", INTERRUPTED
        messages.append(
            AiMessageOut(
                id=m.id,
                role=m.role,  # type: ignore[arg-type]
                content=m.content,
                status=status,  # type: ignore[arg-type]
                error=error,
                created_at=m.created_at,
            )
        )
    items = []
    for it in chat_items(db, chat.id):
        student = db.get(Student, it.student_id)
        status = item_status(it, now)
        items.append(
            AiBatchItemOut(
                id=it.id,
                student_id=it.student_id,
                student_name=student.name if student else "",
                note=it.note,
                status=status,  # type: ignore[arg-type]
                content=it.content,
                error=it.error,
            )
        )
    return AiChatOut(
        id=chat.id,
        title=chat.title,
        template_id=chat.template_id,
        updated_at=chat.updated_at,
        class_id=chat.class_id,
        student_id=chat.student_id,
        save_as=chat.save_as,  # type: ignore[arg-type]
        mask=chat.mask,
        batch_only=chat.batch_only,
        messages=messages,
        items=items,
    )


def list_chats(db: Session, user_id: UUID, class_id: UUID) -> list[AiChatSummaryOut]:
    rows = db.scalars(
        select(AiChat)
        .where(AiChat.user_id == user_id, AiChat.class_id == class_id)
        .order_by(AiChat.updated_at.desc(), AiChat.created_at.desc())
        .limit(LIST_LIMIT)
    )
    return [
        AiChatSummaryOut(id=c.id, title=c.title, template_id=c.template_id, updated_at=c.updated_at)
        for c in rows
    ]


def delete_chat(db: Session, user_id: UUID, chat_id: UUID) -> None:
    chat = get_own_chat(db, user_id, chat_id)
    db.delete(chat)
    db.commit()
