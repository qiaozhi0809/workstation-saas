"""Exam statistics for AI context; rules mirror apps/web/src/shared/lib/grades.ts one for one."""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from uuid import UUID

from app.domain.exams.schemas import SubjectFull

PASS_RATIO = 0.6
GOOD_RATIO = 0.85

Scores = Mapping[UUID, Mapping[str, float | None]]


@dataclass
class Row:
    enrollment_id: UUID
    total: float | None
    rank: int | None
    subs: dict[str, float | None]


@dataclass
class SubjectStats:
    name: str
    full: int
    n: int
    avg: float
    rate: float  # 得分率,百分数 0-100
    max: float
    min: float
    pass_rate: float  # 小数 0-1
    good_rate: float
    low: int  # 低于满分 60% 的人数


@dataclass
class ExamStats:
    full: int
    n: int
    avg: float
    rate: float
    max: float
    min: float
    pass_rate: float
    good_rate: float
    sd: float  # 总分的总体标准差(除以 n)
    table: list[Row]
    subjects: list[SubjectStats]


def _round1(x: float) -> float:
    # 与 JS Math.round(x * 10) / 10 一致(半数向上)
    return math.floor(x * 10 + 0.5) / 10


def exam_table(subjects: Sequence[SubjectFull], scores: Scores, ids: Sequence[UUID]) -> list[Row]:
    rows: list[Row] = []
    for eid in ids:
        rec = scores.get(eid, {})
        subs: dict[str, float | None] = {}
        total: float | None = None
        for s in subjects:
            v = rec.get(s.name)
            subs[s.name] = v
            if v is not None:
                total = (total or 0) + v
        rows.append(Row(eid, None if total is None else _round1(total), None, subs))
    # 稳定排序:有总分的按降序在前,缺总分的排末尾
    rows.sort(key=lambda r: (r.total is None, -(r.total or 0)))
    prev: float | None = None
    prev_rank = 0
    for i, r in enumerate(rows):
        if r.total is None:
            continue
        if r.total != prev:
            prev_rank = i + 1
            prev = r.total
        r.rank = prev_rank
    return rows


def subject_stats(
    subjects: Sequence[SubjectFull], scores: Scores, subject: str, ids: Sequence[UUID]
) -> SubjectStats | None:
    sub = next((s for s in subjects if s.name == subject), None)
    if sub is None:
        return None
    vals = [v for eid in ids if (v := scores.get(eid, {}).get(subject)) is not None]
    n = len(vals)
    if n == 0:
        return None
    avg = sum(vals) / n
    pass_line, good_line = sub.full * PASS_RATIO, sub.full * GOOD_RATIO
    return SubjectStats(
        name=sub.name,
        full=sub.full,
        n=n,
        avg=avg,
        rate=avg / sub.full * 100,
        max=max(vals),
        min=min(vals),
        pass_rate=sum(v >= pass_line for v in vals) / n,
        good_rate=sum(v >= good_line for v in vals) / n,
        low=sum(v < pass_line for v in vals),
    )


def exam_stats(
    subjects: Sequence[SubjectFull], scores: Scores, ids: Sequence[UUID]
) -> ExamStats | None:
    table = exam_table(subjects, scores, ids)
    totals = [r.total for r in table if r.total is not None]
    n = len(totals)
    if n == 0:
        return None
    full = sum(s.full for s in subjects)
    avg = sum(totals) / n
    pass_line, good_line = full * PASS_RATIO, full * GOOD_RATIO
    per_subject = [st for s in subjects if (st := subject_stats(subjects, scores, s.name, ids))]
    return ExamStats(
        full=full,
        n=n,
        avg=avg,
        rate=avg / full * 100,
        max=max(totals),
        min=min(totals),
        pass_rate=sum(t >= pass_line for t in totals) / n,
        good_rate=sum(t >= good_line for t in totals) / n,
        sd=math.sqrt(sum((t - avg) ** 2 for t in totals) / n),
        table=table,
        subjects=per_subject,
    )


def rank_changes(cur: Sequence[Row], prev: Sequence[Row] | None) -> dict[UUID, int]:
    """正 = 进步名次数(prev.rank - cur.rank);任一场没有名次的不计。"""
    if not prev:
        return {}
    before = {r.enrollment_id: r.rank for r in prev}
    return {
        r.enrollment_id: p - r.rank
        for r in cur
        if r.rank is not None and (p := before.get(r.enrollment_id)) is not None
    }
