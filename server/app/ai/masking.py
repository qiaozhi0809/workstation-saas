"""发给外部模型前的脱敏:学生姓名 ↔ 编号、号码过滤、流式换回。"""

import re
from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Enrollment, Student

CODE_RE = re.compile(r"[【\[]学生(\d{1,6})[】\]]")
# 流式尾巴"可能是编号开头":用 \Z 锚定真正的末尾(`$` 还会匹配到结尾换行之前,会把"【\n"多扣一段)
_TAIL_RE = re.compile(r"^[【\[](学(生\d{0,6})?)?\Z")
# 数字含全角;分组之间允许一个空格 / 连字符;号码前后不得紧挨数字
_D = "[0-9０-９]"
_SEP = "[ \u00a0\u3000\t-]?"
_ID_RE = re.compile(rf"(?<!{_D}){_D}{{6}}{_SEP}{_D}{{8}}{_SEP}{_D}{{3}}[0-9０-９XxＸｘ](?!{_D})")
_PHONE_RE = re.compile(
    rf"(?<!{_D})(?:[+＋]?[8８][6６]{_SEP})?[1１][3-9３-９]{_D}{_SEP}{_D}{{4}}{_SEP}{_D}{{4}}(?!{_D})"
)
_REDACTED = "〔号码已隐去〕"


def code_of(mask_no: int) -> str:
    return f"【学生{mask_no:02d}】"


def scrub(text: str) -> str:
    """身份证号、手机号一律隐去(与是否隐去姓名无关)。"""
    return _PHONE_RE.sub(_REDACTED, _ID_RE.sub(_REDACTED, text))


def defuse_codes(text: str) -> str:
    """手写的编号改成 〔学生N〕,使其既不会被换回,也不会被当作 mask() 生成的编号。"""
    return CODE_RE.sub(lambda m: f"〔学生{m.group(1)}〕", text)


class Masker:
    """姓名 ↔ 编号。

    换回(restore / mapping / 流式)只认两类编号:本班名单学生的编号(``class_nos``),
    以及本实例 ``mask()`` 实际生成过的编号(``_emitted``)。其余 ``【学生N】`` 原样保留,
    避免老师手写编号或让模型回显编号来查出全校其他学生的真名。
    """

    def __init__(self, people: Iterable[tuple[str, int]], class_nos: Iterable[int] = ()):
        self._class_nos: frozenset[int] = frozenset(class_nos)
        self._emitted: set[int] = set()
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

        def repl(m: re.Match[str]) -> str:
            no = self._by_name[m.group(0)]
            self._emitted.add(no)
            return code_of(no)

        return self._name_re.sub(repl, text)

    def adopt(self, sent: str) -> None:
        """历史里已脱敏的 ``sent``:其中的编号(落库前已破坏手写编号)都是 mask() 生成的。"""
        for m in CODE_RE.finditer(sent):
            no = int(m.group(1))
            if no in self._by_no:
                self._emitted.add(no)

    def _restorable(self, no: int) -> bool:
        return no in self._by_no and (no in self._class_nos or no in self._emitted)

    def restore(self, text: str) -> str:
        def repl(m: re.Match[str]) -> str:
            no = int(m.group(1))
            return self._by_no[no] if self._restorable(no) else m.group(0)

        return CODE_RE.sub(repl, text)

    def mapping(self, text: str) -> list[tuple[str, str]]:
        used = {int(m.group(1)) for m in CODE_RE.finditer(text)}
        return [(code_of(n), self._by_no[n]) for n in sorted(used) if self._restorable(n)]

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


def masker_for_school(db: Session, school_id: UUID, class_id: UUID | None = None) -> Masker:
    """替换表 = 本校全部学生(不论注册状态与学年),按 mask_no 排序。

    换回范围:``class_id`` 给定时含该班在读学生;其余只换回 ``mask()`` 生成过的编号。

    同名学生共用第一个(mask_no 最小的)编号,与 Masker 的 setdefault 行为一致。
    """
    rows = db.execute(
        select(Student.name, Student.mask_no)
        .where(Student.school_id == school_id)
        .order_by(Student.mask_no)
    ).all()
    class_nos: list[int] = []
    if class_id is not None:
        class_nos = list(
            db.scalars(
                select(Student.mask_no)
                .join(Enrollment, Enrollment.student_id == Student.id)
                .where(
                    Student.school_id == school_id,
                    Enrollment.class_id == class_id,
                    Enrollment.status == "active",
                )
            )
        )
    return Masker(((name, mask_no) for name, mask_no in rows), class_nos)
