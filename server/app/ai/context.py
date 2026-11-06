"""Permission-clipped text material (system prompt, class / student / exam context) for the AI.

Rules: every block is clipped by ``Access`` (what the caller may see in this class); student
contacts never appear; names are real here, masking happens later in ``app.ai.masking``.
"""

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.stats import (
    ExamStats,
    Row,
    exam_stats,
    exam_table,
    rank_changes,
    score_line,
    subject_stats,
)
from app.domain.exams.schemas import SubjectFull
from app.domain.exams.service import _scores_by_enrollment, _visible_of
from app.domain.exams.subjects import Stage, stage_of
from app.domain.school_settings.schemas import Grading
from app.domain.school_settings.service import get_grading
from app.domain.schools.service import local_day_start_utc, school_tz, week_no
from app.domain.students.service import active_enrollments
from app.models import (
    AcademicYear,
    Attendance,
    Enrollment,
    Exam,
    Grade,
    GrowthRecord,
    Review,
    School,
    SchoolClass,
    Student,
    User,
)
from app.rbac.bindings import (
    Binding,
    Scope,
    can,
    has_role_in_class,
    subjects_in_class,
    visible_subjects,
)
from app.rbac.roles import Perm, Role

STAGE_LABEL: dict[Stage, str] = {"primary": "小学", "junior": "初中", "senior": "高中"}
# 本班最高身份:班主任 > 副班主任 > 任课老师
_ROLE_LABEL = (
    (Role.homeroom_teacher, "班主任"),
    (Role.assistant_teacher, "副班主任"),
    (Role.subject_teacher, "任课老师"),
)
_BEHAVIOR_TOP = 4
_GROWTH_LIMIT = 6
_REVIEW_DAYS = 30
_MOVE_THRESHOLD = 5
_GROWTH_PREVIEW = 60

_SYSTEM_HEAD = (
    "你是一位熟悉中国中小学教育的班主任助手，擅长备课、班级管理和家校沟通，说话真诚、务实。\n"
    "请遵守：\n"
    "1. 用简体中文写作，具体、有温度，不说空话套话，不夸大；\n"
    "2. 用 Markdown 排版（标题、列表，需要时用表格），方便老师直接复制；\n"
    "3. 只使用老师给出的信息，不虚构事实、分数、奖项或数据；"
    "信息不足时写「（待补充：……）」提醒老师；\n"
    "4. 谈到学生时着眼成长、多鼓励，不贴标签，不用排名公开比较学生，注意保护隐私；\n"
    "5. 材料中形如「【学生07】」的编号各代表一位学生，请保持原样，不要改写，也不要换成名字。\n"
)


@dataclass
class Access:
    """调用者在某班能看到的资料范围。"""

    family: bool
    learning: bool
    profile: bool
    exam: bool
    review: bool
    growth: bool
    attendance: bool
    visible_subjects: frozenset[str] | None  # None = 全部科目

    @classmethod
    def of(cls, bindings: Sequence[Binding], scope: Scope) -> "Access":
        # 权限点 → 字段:家庭结构 / 家庭备注 = student.read_family;学习情况 = student.read_learning;
        # 性格特长 / 健康 / 标签 / 其他备注 = student.read_profile;成绩 = exam.read;
        # 点评 = review.read;成长记录 = growth.read;考勤 = attendance.read。联系人从不输出。
        return cls(
            family=can(bindings, Perm.STUDENT_FAMILY, scope),
            learning=can(bindings, Perm.STUDENT_LEARNING, scope),
            profile=can(bindings, Perm.STUDENT_PROFILE, scope),
            exam=can(bindings, Perm.EXAM_READ, scope),
            review=can(bindings, Perm.REVIEW_READ, scope),
            growth=can(bindings, Perm.GROWTH_READ, scope),
            attendance=can(bindings, Perm.ATTENDANCE_READ, scope),
            visible_subjects=visible_subjects(bindings, scope),
        )


# ---------------------------------------------------------------- 系统提示


def system_prompt(db: Session, user: User, bindings: Sequence[Binding], cls: SchoolClass) -> str:
    school = db.get(School, cls.school_id)
    grade = db.get(Grade, cls.grade_id)
    role = next((label for r, label in _ROLE_LABEL if has_role_in_class(bindings, cls.id, {r})), "")
    subjects = "、".join(subjects_in_class(bindings, cls.id))
    teaching = f"，任教{subjects}" if subjects else ""
    stage = STAGE_LABEL[stage_of(grade.name if grade else "")]
    school_name = school.name if school else ""
    return (
        f"{_SYSTEM_HEAD}当前老师：{user.display_name}，{school_name}{cls.name}{role}{teaching}"
        f"；学段：{stage}。"
    )


# ---------------------------------------------------------------- 取数


def visible_exams(db: Session, cls: SchoolClass, access: Access) -> list[Exam]:
    """本班调用者可见的考试,旧 → 新。"""
    exams = list(
        db.scalars(
            select(Exam)
            .where(Exam.class_id == cls.id)
            .order_by(Exam.date, Exam.created_at, Exam.id)
        ).all()
    )
    visible = access.visible_subjects
    if visible is None:
        return exams
    return [e for e in exams if any(s["name"] in visible for s in e.subjects)]


def _scores_of(
    db: Session, exams: Sequence[Exam], ids: Sequence[UUID], access: Access
) -> dict[UUID, dict[UUID, dict[str, float | None]]]:
    allowed = {e.id: {s.name for s in _visible_of(e, access.visible_subjects)} for e in exams}
    return _scores_by_enrollment(db, [e.id for e in exams], set(ids), allowed)


def load_exam_data(
    db: Session, cls: SchoolClass, exam: Exam, access: Access
) -> tuple[list[SubjectFull], dict[UUID, dict[str, float | None]], list[UUID]]:
    """已按可见科目裁剪的 (科目, 分数, 在籍 enrollment_id),可直接喂给 ``app.ai.stats``。"""
    ids = [e.id for e in active_enrollments(db, cls.id)]
    scores = _scores_of(db, [exam], ids, access)[exam.id]
    return _visible_of(exam, access.visible_subjects), scores, ids


def _names(db: Session, enrollment_ids: Iterable[UUID]) -> dict[UUID, str]:
    rows = db.execute(
        select(Enrollment.id, Student.name)
        .join(Student, Student.id == Enrollment.student_id)
        .where(Enrollment.id.in_(list(enrollment_ids)))
    )
    return {eid: name for eid, name in rows}


def _g(x: float) -> str:
    return f"{x:g}"


def _counts(items: Iterable[str], top: int | None = None) -> str:
    """理由×次数,次数降序,同次数按文字。"""
    ranked = sorted(Counter(items).items(), key=lambda kv: (-kv[1], kv[0]))
    return "、".join(f"{k}×{n}" for k, n in ranked[:top])


def _behavior_line(label: str, reasons: Sequence[str], top: int | None = None) -> str:
    return f"{label}：{_counts(reasons, top)}" if reasons else ""


# ---------------------------------------------------------------- 班级资料


def class_context(db: Session, cls: SchoolClass, access: Access, today: date) -> str:
    school = db.get(School, cls.school_id)
    grade = db.get(Grade, cls.grade_id)
    year = db.get(AcademicYear, cls.academic_year_id)
    grade_name = grade.name if grade else ""
    roster = db.execute(
        select(Enrollment, Student)
        .join(Student, Student.id == Enrollment.student_id)
        .where(Enrollment.class_id == cls.id, Enrollment.status == "active")
        .order_by(Student.mk)
    ).all()
    boys = sum(1 for _, s in roster if s.gender == "男")
    girls = sum(1 for _, s in roster if s.gender == "女")
    week = f"，第 {week_no(year.start_date, today)} 周" if year else ""
    lines = [
        "【班级概况】",
        f"学校：{school.name if school else ''}；班级：{grade_name} {cls.name}；"
        f"学段：{STAGE_LABEL[stage_of(grade_name)]}；学年：{year.name if year else ''}{week}",
        f"人数：{len(roster)}（男 {boys}，女 {girls}）",
    ]
    cadres = [f"{s.name}（{e.class_role}）" for e, s in roster if e.class_role]
    lines.append(f"班干部：{'、'.join(cadres) if cadres else '无'}")
    if access.profile:
        tags = Counter(t for _, s in roster for t in s.tags)
        if tags:
            ranked = sorted(tags.items(), key=lambda kv: (-kv[1], kv[0]))
            lines.append("标签：" + "、".join(f"{t}×{n}" for t, n in ranked))
    if access.exam:
        lines.append(_latest_exam_line(db, cls, access))
    if access.review:
        lines.append(_class_review_line(db, cls, today))
    if access.growth:
        lines.extend(_class_growth_lines(db, cls))
    return "\n".join(line for line in lines if line)


def _latest_exam_line(db: Session, cls: SchoolClass, access: Access) -> str:
    ids = [e.id for e in active_enrollments(db, cls.id)]
    exams = visible_exams(db, cls, access)
    scores = _scores_of(db, exams, ids, access)
    ratios = get_grading(db, cls.school_id)
    for exam in reversed(exams):
        subjects = _visible_of(exam, access.visible_subjects)
        st = exam_stats(subjects, scores[exam.id], ids, ratios=ratios)
        if st is None:
            continue
        rates = "、".join(f"{s.name} {s.rate:.1f}%" for s in st.subjects)
        return (
            f"最近考试：{exam.name}（{exam.date.isoformat()}），平均分 {st.avg:.1f}，"
            f"及格率 {st.pass_rate * 100:.0f}%，优秀率 {st.good_rate * 100:.0f}%；"
            f"各科得分率：{rates}"
        )
    return ""


def _class_review_line(db: Session, cls: SchoolClass, today: date) -> str:
    since = local_day_start_utc(today - timedelta(days=_REVIEW_DAYS), school_tz(db, cls.school_id))
    rows = db.execute(
        select(Review.op_id, Review.reason_text, Review.score_delta).where(
            Review.class_id == cls.id, Review.revoked_at.is_(None), Review.given_at >= since
        )
    ).all()
    # 全班点评一次会给每位同学各记一行,按 op_id 合并成"一次"
    events = {op: (reason, delta) for op, reason, delta in rows}.values()
    plus = [r for r, d in events if d > 0]
    minus = [r for r, d in events if d < 0]
    if not events:
        return ""
    parts = [f"近 {_REVIEW_DAYS} 天点评：加分 {len(plus)} 次，扣分 {len(minus)} 次"]
    if plus:
        parts.append(f"常见加分：{_counts(plus, _BEHAVIOR_TOP)}")
    if minus:
        parts.append(f"常见扣分：{_counts(minus, _BEHAVIOR_TOP)}")
    return "；".join(parts)


def _class_growth_lines(db: Session, cls: SchoolClass) -> list[str]:
    rows = db.execute(
        select(GrowthRecord, Student.name)
        .join(Student, Student.id == GrowthRecord.student_id)
        .where(
            GrowthRecord.class_id == cls.id,
            GrowthRecord.academic_year_id == cls.academic_year_id,
        )
        .order_by(GrowthRecord.date.desc(), GrowthRecord.created_at.desc(), GrowthRecord.id)
        .limit(_GROWTH_LIMIT)
    ).all()
    if not rows:
        return []
    return ["近期成长记录："] + [
        f"- {g.date.isoformat()} {name} {g.type}：{g.content[:_GROWTH_PREVIEW]}" for g, name in rows
    ]


# ---------------------------------------------------------------- 学生资料


def _age(birthdate: date, today: date) -> int:
    return (
        today.year - birthdate.year - ((today.month, today.day) < (birthdate.month, birthdate.day))
    )


def student_context(
    db: Session, student: Student, enrollment: Enrollment, access: Access, today: date
) -> str:
    # 联系人(student.contacts)任何情况下都不输出
    basics = [f"姓名：{student.name}"]
    if student.gender:
        basics.append(f"性别：{student.gender}")
    if student.birthdate:
        basics.append(f"年龄：{_age(student.birthdate, today)} 岁")
    if enrollment.class_role:
        basics.append(f"职务：{enrollment.class_role}")
    if access.profile and student.tags:
        basics.append(f"标签：{'、'.join(student.tags)}")
    lines = ["【学生档案】", "；".join(basics)]
    if access.family:
        family = [
            f"{k}：{v}"
            for k, v in (("家庭", student.family_structure), ("备注", student.family_note))
            if v
        ]
        lines.append("；".join(family))
    if access.learning and student.learning_summary:
        lines.append(f"学习情况：{student.learning_summary}")
    if access.profile:
        traits = [
            f"{k}：{v}"
            for k, v in (("性格特长", student.personality), ("健康", student.health_notes))
            if v
        ]
        lines.append("；".join(traits))
        if student.note:
            lines.append(f"其他备注：{student.note}")
    if access.exam:
        lines.extend(_student_exam_lines(db, enrollment, access))
    if access.review:
        lines.append(_student_review_line(db, enrollment))
    if access.growth:
        lines.extend(_student_growth_lines(db, student))
    if access.attendance:
        lines.append(_attendance_line(db, enrollment))
    return "\n".join(line for line in lines if line)


def _student_exam_lines(db: Session, enrollment: Enrollment, access: Access) -> list[str]:
    cls = db.get(SchoolClass, enrollment.class_id)
    assert cls is not None
    ids = [e.id for e in active_enrollments(db, cls.id)]
    if enrollment.id not in ids:
        ids.append(enrollment.id)
    exams = visible_exams(db, cls, access)
    scores = _scores_of(db, exams, ids, access)
    history: list[str] = []
    latest: tuple[Exam, list[SubjectFull]] | None = None
    for exam in exams:
        sc = scores[exam.id]
        if not sc.get(enrollment.id):
            continue
        subjects = _visible_of(exam, access.visible_subjects)
        latest = (exam, subjects)
        table = exam_table(subjects, sc, ids)
        row = next(r for r in table if r.enrollment_id == enrollment.id)
        if row.total is None:
            continue
        n = sum(1 for r in table if r.total is not None)
        label = "总分" if access.visible_subjects is None else "+".join(s.name for s in subjects)
        history.append(f"{exam.name} {label} {_g(row.total)}（第 {row.rank}/{n} 名）")
    lines = ["成绩：" + "；".join(history)] if history else []
    if latest:
        exam, subjects = latest
        mine = scores[exam.id][enrollment.id]
        ratios = get_grading(db, cls.school_id)
        parts = []
        for s in subjects:
            if s.name not in mine:
                continue
            st = subject_stats(subjects, scores[exam.id], s.name, ids, ratios=ratios)
            avg = f"（班均 {st.avg:.1f}）" if st else ""
            parts.append(f"{s.name} {'缺考' if mine[s.name] is None else _g(mine[s.name])}{avg}")
        if parts:
            lines.append("最近一次考试各科：" + "、".join(parts))
    return lines


def _student_review_line(db: Session, enrollment: Enrollment) -> str:
    rows = db.execute(
        select(Review.reason_text, Review.score_delta).where(
            Review.enrollment_id == enrollment.id, Review.revoked_at.is_(None)
        )
    ).all()
    if not rows:
        return ""
    parts = [f"课堂点评：累计 {sum(d for _, d in rows):+d} 分"]
    for label, picked in (
        ("加分理由", [r for r, d in rows if d > 0]),
        ("扣分理由", [r for r, d in rows if d < 0]),
    ):
        if picked:
            parts.append(f"{label}：{_counts(picked)}")
    return "；".join(parts)


def _student_growth_lines(db: Session, student: Student) -> list[str]:
    rows = db.scalars(
        select(GrowthRecord)
        .where(GrowthRecord.student_id == student.id)
        .order_by(GrowthRecord.date.desc(), GrowthRecord.created_at.desc(), GrowthRecord.id)
        .limit(_GROWTH_LIMIT)
    ).all()
    if not rows:
        return []
    return ["近期成长记录："] + [f"- {g.date.isoformat()} {g.type}：{g.content}" for g in rows]


def _attendance_line(db: Session, enrollment: Enrollment) -> str:
    year = db.get(AcademicYear, enrollment.academic_year_id)
    stmt = (
        select(Attendance.status, func.count())
        .where(Attendance.enrollment_id == enrollment.id)
        .group_by(Attendance.status)
    )
    if year:
        stmt = stmt.where(Attendance.date.between(year.start_date, year.end_date))
    got = dict(db.execute(stmt).all())
    return (
        f"考勤（本学年）：请假 {got.get('leave', 0)} 天，缺勤 {got.get('absent', 0)} 天，"
        f"迟到 {got.get('late', 0)} 天"
    )


# ---------------------------------------------------------------- 考试资料


def _rank_tables(
    db: Session, cls: SchoolClass, exam: Exam, compare: Exam, access: Access
) -> tuple[list[Row], list[Row]]:
    """本场与对比场的名次表(同一份在籍名单)。"""
    subjects, scores, ids = load_exam_data(db, cls, exam, access)
    psubjects, pscores, _ = load_exam_data(db, cls, compare, access)
    return exam_table(subjects, scores, ids), exam_table(psubjects, pscores, ids)


def _moved(
    db: Session, cur: Sequence[Row], prev: Sequence[Row], threshold: int, *, up: bool
) -> list[tuple[Enrollment, int]]:
    """进步(``up``)或退步 ``threshold`` 名及以上的学生,按变动名次数降序;
    只用两张已算好的名次表,不再取数。"""
    changes = rank_changes(cur, prev)
    sign = 1 if up else -1
    picked = [
        (r.enrollment_id, sign * changes[r.enrollment_id])
        for r in cur
        if sign * changes.get(r.enrollment_id, 0) >= threshold
    ]
    picked.sort(key=lambda t: -t[1])
    return [(db.get(Enrollment, eid), n) for eid, n in picked]  # type: ignore[misc]


def regressed_students(
    db: Session,
    cls: SchoolClass,
    exam: Exam,
    compare: Exam,
    access: Access,
    threshold: int = _MOVE_THRESHOLD,
) -> list[tuple[Enrollment, int]]:
    """退步 ``threshold`` 名及以上的学生,按退步名次数降序。"""
    cur, prev = _rank_tables(db, cls, exam, compare, access)
    return _moved(db, cur, prev, threshold, up=False)


def progressed_students(
    db: Session,
    cls: SchoolClass,
    exam: Exam,
    compare: Exam,
    access: Access,
    threshold: int = _MOVE_THRESHOLD,
) -> list[tuple[Enrollment, int]]:
    """进步 ``threshold`` 名及以上的学生,按进步名次数降序。"""
    cur, prev = _rank_tables(db, cls, exam, compare, access)
    return _moved(db, cur, prev, threshold, up=True)


def failing_students(
    db: Session, cls: SchoolClass, exam: Exam, access: Access
) -> list[tuple[Enrollment, int]]:
    """可见科目里有两科及以上低于及格线(学校设置的比例)的学生 (enrollment, 不及格科数),科数降序。"""
    subjects, scores, ids = load_exam_data(db, cls, exam, access)
    table = exam_table(subjects, scores, ids)
    pass_ratio = get_grading(db, cls.school_id).pass_ratio
    found = []
    for r in table:
        count = sum(
            1
            for s in subjects
            if (v := r.subs[s.name]) is not None and v < score_line(s.full, pass_ratio)
        )
        if count >= 2:
            found.append((r.enrollment_id, count))
    found.sort(key=lambda t: -t[1])
    return [(db.get(Enrollment, eid), n) for eid, n in found]  # type: ignore[misc]


def _moves_text(moves: Sequence[tuple[Enrollment, int]], names: dict[UUID, str], sign: str) -> str:
    if not moves:
        return "无"
    return "、".join(f"{names[e.id]}（{sign}{n}）" for e, n in moves)


def exam_context(
    db: Session, cls: SchoolClass, exam: Exam, compare: Exam | None, access: Access
) -> str:
    subjects, scores, ids = load_exam_data(db, cls, exam, access)
    ratios = get_grading(db, cls.school_id)
    st = exam_stats(subjects, scores, ids, ratios=ratios)
    full = sum(s.full for s in subjects)
    lines = [
        "【考试数据】",
        f"考试：{exam.name}（{exam.exam_type}，{exam.date.isoformat()}）；"
        f"参考人数 {st.n if st else 0}；满分 {_g(full)}",
    ]
    if st is None:
        return "\n".join([*lines, "暂无成绩"])
    total_label = "总分" if access.visible_subjects is None else "任教科目合计"
    lines.append(
        f"{total_label}：平均 {st.avg:.1f}，最高 {_g(st.max)}，最低 {_g(st.min)}，"
        f"及格率 {st.pass_rate * 100:.0f}%，优秀率 {st.good_rate * 100:.0f}%，标准差 {st.sd:.1f}"
    )
    lines.append("各科：")
    lines.extend(
        f"- {s.name}（满分 {_g(s.full)}）：平均 {s.avg:.1f}，得分率 {s.rate:.1f}%，"
        f"及格率 {s.pass_rate * 100:.0f}%，优秀率 {s.good_rate * 100:.0f}%，"
        f"最高 {_g(s.max)}，最低 {_g(s.min)}，不及格 {s.low} 人"
        for s in st.subjects
    )
    names = _names(db, ids)
    top = [r for r in st.table if r.total is not None][:5]
    lines.append(
        "前 5 名：" + "、".join(f"{names[r.enrollment_id]} {_g(r.total or 0)}" for r in top)
    )
    if compare is not None:
        lines.extend(_compare_lines(db, cls, exam, compare, access, st, names, ratios))
    if len(subjects) >= 2:
        failing = failing_students(db, cls, exam, access)
        lines.append("两科及以上不及格：" + ("、".join(names[e.id] for e, _ in failing) or "无"))
    return "\n".join(lines)


def _compare_lines(
    db: Session,
    cls: SchoolClass,
    exam: Exam,
    compare: Exam,
    access: Access,
    st: ExamStats,
    names: dict[UUID, str],
    ratios: Grading,
) -> list[str]:
    psubjects, pscores, ids = load_exam_data(db, cls, compare, access)
    prev = exam_stats(psubjects, pscores, ids, ratios=ratios)
    if prev is None:
        return []
    before = {s.name: s.rate for s in prev.subjects}
    subs = "、".join(
        f"{s.name} {before[s.name]:.1f}% → {s.rate:.1f}%（{s.rate - before[s.name]:+.1f}）"
        for s in st.subjects
        if s.name in before
    )
    head = (
        f"对比「{compare.name}」：总分得分率 {prev.rate:.1f}% → {st.rate:.1f}%"
        f"（{st.rate - prev.rate:+.1f} 个百分点）"
    )
    # 两张名次表 exam_stats 已经算好(st.table / prev.table),进步 / 退步名单直接复用,不再取数
    up = _moved(db, st.table, prev.table, _MOVE_THRESHOLD, up=True)
    down = _moved(db, st.table, prev.table, _MOVE_THRESHOLD, up=False)
    return [
        head + (f"；各科：{subs}" if subs else ""),
        f"进步 {_MOVE_THRESHOLD} 名及以上：{_moves_text(up, names, '+')}",
        f"退步 {_MOVE_THRESHOLD} 名及以上：{_moves_text(down, names, '-')}",
    ]
