import csv
import io
import re

from app.domain.accounts.schemas import LOGIN_RE, PHONE_RE, ImportRow
from app.errors import ApiError

MAX_ROWS = 500
HEADERS = ("登录名", "姓名", "工号", "科目", "手机")
_SUBJECT_SPLIT = re.compile(r"[、/]")


def _bad_header() -> ApiError:
    return ApiError(400, "IMPORT_INVALID", "表头应为:登录名,姓名,工号,科目,手机")


def parse_csv(text: str, existing_logins: set[str]) -> list[ImportRow]:
    """existing_logins 为小写登录名集合;逐行校验,不抛行级错误。"""
    reader = csv.reader(io.StringIO(text.lstrip("﻿")))
    header = next(reader, None)
    if header is None:
        raise _bad_header()
    names = [h.strip() for h in header]
    if sorted(names) != sorted(HEADERS):
        raise _bad_header()
    index = {name: names.index(name) for name in HEADERS}

    rows: list[ImportRow] = []
    seen: set[str] = set()
    for line, cells in enumerate(reader, start=2):
        if not any(c.strip() for c in cells):
            continue

        def cell(name: str, cells: list[str] = cells) -> str:
            i = index[name]
            return cells[i].strip() if i < len(cells) else ""

        login = cell("登录名")
        name = cell("姓名")
        phone = cell("手机")
        subjects = [s.strip() for s in _SUBJECT_SPLIT.split(cell("科目")) if s.strip()]
        error = None
        if not LOGIN_RE.fullmatch(login):
            error = "登录名格式不对"
        elif login.lower() in seen:
            error = "登录名重复"
        elif login.lower() in existing_logins:
            error = "登录名已被使用"
        elif not name or len(name) > 20:
            error = "姓名不能为空" if not name else "姓名最多 20 个字"
        elif phone and not PHONE_RE.fullmatch(phone):
            error = "手机号应为 11 位数字"
        elif len(cell("工号")) > 20:
            error = "工号最多 20 个字"
        elif len(subjects) > 6 or any(len(s) > 10 for s in subjects):
            error = "科目最多 6 项,每项不超过 10 个字"
        if login:
            seen.add(login.lower())
        rows.append(
            ImportRow(
                line=line,
                login_name=login,
                display_name=name,
                employee_no=cell("工号") or None,
                subjects=subjects,
                phone=phone or None,
                error=error,
            )
        )
    if len(rows) > MAX_ROWS:
        raise ApiError(400, "IMPORT_INVALID", f"单次最多导入 {MAX_ROWS} 行")
    return rows
