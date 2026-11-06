import re
from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, BeforeValidator, Field

LOGIN_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
PHONE_RE = re.compile(r"^[0-9]{11}$")


def _blank_to_none(value: object) -> object:
    if isinstance(value, str):
        return value.strip() or None
    return value


def _check_phone(value: str | None) -> str | None:
    if value is not None and not PHONE_RE.fullmatch(value):
        raise ValueError("手机号应为 11 位数字")
    return value


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


Phone = Annotated[str | None, BeforeValidator(_blank_to_none), AfterValidator(_check_phone)]


def _check_employee_no(value: str | None) -> str | None:
    if value is not None and len(value) > 20:
        raise ValueError("工号最多 20 个字")
    return value


EmployeeNo = Annotated[
    str | None, BeforeValidator(_blank_to_none), AfterValidator(_check_employee_no)
]
DisplayName = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=20)]
Subject = Annotated[str, BeforeValidator(_strip), Field(min_length=1, max_length=10)]
LoginName = Annotated[
    str, BeforeValidator(_strip), Field(min_length=3, max_length=32, pattern=LOGIN_RE.pattern)
]


class RoleTag(BaseModel):
    role: str
    label: str


class Account(BaseModel):
    id: UUID
    login_name: str
    display_name: str
    phone: str | None
    employee_no: str | None
    subjects: list[str]
    status: str
    must_change_password: bool
    last_login_at: datetime | None
    totp_enabled: bool
    roles: list[RoleTag]


class AccountInput(BaseModel):
    display_name: DisplayName
    phone: Phone
    employee_no: EmployeeNo
    subjects: Annotated[list[Subject], Field(max_length=6)]


class AccountCreate(AccountInput):
    login_name: LoginName


class AccountPage(BaseModel):
    items: list[Account]
    total: int


class AccountCreated(BaseModel):
    account: Account
    temp_password: str


class TempPassword(BaseModel):
    temp_password: str


class ImportRow(BaseModel):
    line: int
    login_name: str
    display_name: str
    employee_no: str | None
    subjects: list[str]
    phone: str | None
    error: str | None


class ImportRequest(BaseModel):
    csv: str = Field(max_length=2_000_000)


class ImportPreview(BaseModel):
    rows: list[ImportRow]


class ImportedAccount(BaseModel):
    login_name: str
    display_name: str
    temp_password: str


class ImportResult(BaseModel):
    created: list[ImportedAccount]
