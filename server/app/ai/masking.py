"""发给外部模型前的脱敏:学生姓名 ↔ 编号、号码过滤、流式换回。"""

import re
from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Enrollment, Student

CODE_RE = re.compile(r"[【\[]学生(\d{1,6})[】\]]")
_TAIL_RE = re.compile(r"^[【\[](学(生\d{0,6})?)?$")
_ID_RE = re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")
_PHONE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
_REDACTED = "〔号码已隐去〕"


def code_of(mask_no: int) -> str:
    return f"【学生{mask_no:02d}】"


def scrub(text: str) -> str:
    """身份证号、手机号一律隐去(与是否隐去姓名无关)。"""
    return _PHONE_RE.sub(_REDACTED, _ID_RE.sub(_REDACTED, text))


class Masker:
    def __init__(self, people: Iterable[tuple[str, int]]):
        self._by_name: dict[str, int] = {}
        for name, mask_no in people:
            name = name.strip()
            if len(name) >= 2:
                self._by_name.setdefault(name, mask_no)
        self._by_no: dict[int, str] = {}
        for name, mask_no in self._by_name.items():
            self._by_no.setdefault(mask_no, name)
        names = sorted(self._by_name, key=len, reverse=True)
        self._name_re = re.compile("|".join(map(re.escape, names))) if names else None

    def mask(self, text: str) -> str:
        if self._name_re is None:
            return text
        return self._name_re.sub(lambda m: code_of(self._by_name[m.group(0)]), text)

    def restore(self, text: str) -> str:
        def repl(m: re.Match[str]) -> str:
            return self._by_no.get(int(m.group(1)), m.group(0))

        return CODE_RE.sub(repl, text)

    def mapping(self, text: str) -> list[tuple[str, str]]:
        used = {int(m.group(1)) for m in CODE_RE.finditer(text)}
        return [(code_of(n), self._by_no[n]) for n in sorted(used) if n in self._by_no]

    def restorer(self) -> "StreamRestorer":
        return StreamRestorer(self)


class StreamRestorer:
    """流式换回:可能是编号开头的尾巴先扣住,等下一段再处理。"""

    def __init__(self, masker: Masker):
        self._masker = masker
        self._buf = ""

    def feed(self, chunk: str) -> str:
        self._buf += chunk
        cut = self._held_start(self._buf)
        ready, self._buf = self._buf[:cut], self._buf[cut:]
        return self._masker.restore(ready)

    def flush(self) -> str:
        rest, self._buf = self._buf, ""
        return self._masker.restore(rest)

    @staticmethod
    def _held_start(buf: str) -> int:
        start = max(buf.rfind("【"), buf.rfind("["))
        if start >= 0 and _TAIL_RE.match(buf[start:]):
            return start
        return len(buf)


def masker_for_class(db: Session, class_id: UUID) -> Masker:
    """替换表 = 本班全部注册记录(任何 status)的学生。"""
    rows = db.execute(
        select(Student.name, Student.mask_no)
        .join(Enrollment, Enrollment.student_id == Student.id)
        .where(Enrollment.class_id == class_id)
        .distinct()
        .order_by(Student.mask_no)
    ).all()
    return Masker((name, mask_no) for name, mask_no in rows)
