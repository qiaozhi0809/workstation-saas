from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, Field

ParentRelation = Literal["父亲", "母亲", "祖辈", "其他"]


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


class ParentInput(BaseModel):
    phone: Annotated[str, BeforeValidator(_strip)]
    name: Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=20)]
    relation: ParentRelation


class ParentOfStudent(BaseModel):
    link_id: UUID
    user_id: UUID
    name: str
    relation: ParentRelation
    phone: str
    is_primary: bool
    status: Literal["active", "readonly"]
    account_status: Literal["active", "frozen", "archived"]
    shared_account: bool
    must_change_password: bool


class ParentCreated(BaseModel):
    parent: ParentOfStudent
    temp_password: str | None


class ParentTempPassword(BaseModel):
    temp_password: str
