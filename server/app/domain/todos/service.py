from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.todos.schemas import TodoCreate, TodoPatch
from app.errors import ApiError
from app.models import Todo


def list_todos(db: Session, user_id: UUID) -> list[Todo]:
    stmt = (
        select(Todo)
        .where(Todo.owner_user_id == user_id)
        .order_by(Todo.done.asc(), Todo.created_at.desc(), Todo.id.desc())
        .limit(200)
    )
    return list(db.scalars(stmt))


def _get_owned(db: Session, user_id: UUID, todo_id: UUID) -> Todo:
    todo = db.scalar(select(Todo).where(Todo.id == todo_id, Todo.owner_user_id == user_id))
    if todo is None:
        raise ApiError(404, "NOT_FOUND", "待办不存在")
    return todo


def create_todo(db: Session, user_id: UUID, body: TodoCreate) -> Todo:
    todo = Todo(owner_user_id=user_id, content=body.content)
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


def patch_todo(db: Session, user_id: UUID, todo_id: UUID, body: TodoPatch) -> Todo:
    todo = _get_owned(db, user_id, todo_id)
    if body.content is not None:
        todo.content = body.content
    if body.done is not None:
        todo.done = body.done
    db.commit()
    db.refresh(todo)
    return todo


def delete_todo(db: Session, user_id: UUID, todo_id: UUID) -> None:
    db.delete(_get_owned(db, user_id, todo_id))
    db.commit()
