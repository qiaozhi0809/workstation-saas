from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.domain.todos import service
from app.domain.todos.schemas import TodoCreate, TodoList, TodoOut, TodoPatch
from app.models import User

router = APIRouter(prefix="/me/todos", tags=["todos"])

DbDep = Annotated[Session, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=TodoList)
def list_todos(db: DbDep, user: UserDep) -> TodoList:
    return TodoList(items=[TodoOut.model_validate(t) for t in service.list_todos(db, user.id)])


@router.post("", response_model=TodoOut, status_code=201)
def create_todo(body: TodoCreate, db: DbDep, user: UserDep) -> TodoOut:
    return TodoOut.model_validate(service.create_todo(db, user.id, body))


@router.patch("/{todo_id}", response_model=TodoOut)
def patch_todo(todo_id: UUID, body: TodoPatch, db: DbDep, user: UserDep) -> TodoOut:
    return TodoOut.model_validate(service.patch_todo(db, user.id, todo_id, body))


@router.delete("/{todo_id}", status_code=204)
def delete_todo(todo_id: UUID, db: DbDep, user: UserDep) -> Response:
    service.delete_todo(db, user.id, todo_id)
    return Response(status_code=204)
