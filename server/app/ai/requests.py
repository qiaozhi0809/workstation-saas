"""把老师的模板表单 / 自由对话请求解析成发给 AI 的文字(校验权限、字段,组装、过滤号码、按需脱敏)。"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import date
from typing import Any
from uuid import UUID

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.context import (
    _STAGE_LABEL,
    Access,
    _visible_exams,
    class_context,
    exam_context,
    regressed_students,
    student_context,
    system_prompt,
)
from app.ai.masking import Masker, masker_for_class, scrub
from app.ai.prompts import task_text
from app.ai.settings import AIConfig
from app.ai.templates import (
    CONTEXT_ORDER,
    DEFAULT_GRADE,
    DEFAULT_TEACHER_SUBJECT,
    PERM_ORDER,
    TEMPLATES,
    Field,
    Template,
)
from app.audit.service import deny
from app.domain.ai.schemas import AiRequestIn
from app.domain.classes.service import class_scope_of
from app.domain.exams.service import get_visible_exam
from app.domain.exams.subjects import stage_of
from app.errors import ApiError
from app.models import Enrollment, Exam, Grade, SchoolClass, Student, User
from app.rbac.bindings import Binding, can, subjects_in_class
from app.rbac.roles import Perm

TEXT_MAX = 100
TEXTAREA_MAX = 2000
CHAT_TEXT_MAX = 4000
STUDENTS_MAX = 80
TITLE_TEXT_MAX = 20
BATCH_INTRO = (
    "下面是 {n} 位同学的资料，请逐一完成任务，每位同学之间用「### 学生编号或姓名」作为小标题分开。"
)


@dataclass
class Job:
    sent: str
    student_id: UUID | None
    enrollment_id: UUID | None
    note: str | None
    student_ids: list[UUID]


@dataclass
class Resolved:
    template: Template | None
    title: str
    show: str
    params: dict
    student_id: UUID | None
    save_as: str | None
    batch_only: bool
    masked: bool
    masker: Masker
    system: str
    jobs: list[Job] = field(default_factory=list)


def _bad(field_key: str, message: str) -> ApiError:
    return ApiError(400, "AI_FIELD_INVALID", message, {"field": field_key})


# ---------------------------------------------------------------- 取数辅助


def _grade_name(db: Session, cls: SchoolClass) -> str:
    grade = db.get(Grade, cls.grade_id)
    return grade.name if grade else ""


def _stage_label(db: Session, cls: SchoolClass) -> str:
    return _STAGE_LABEL[stage_of(_grade_name(db, cls))]


def field_defaults(db: Session, bindings: Sequence[Binding], cls: SchoolClass) -> dict[str, str]:
    """占位默认值 → 当前调用者 / 班级的实际值。"""
    subjects = subjects_in_class(bindings, cls.id)
    return {
        DEFAULT_TEACHER_SUBJECT: subjects[0] if subjects else "",
        DEFAULT_GRADE: _grade_name(db, cls),
    }


def effective_default(f: Field, defaults: dict[str, str]) -> str | bool | None:
    if isinstance(f.default, str):
        return defaults.get(f.default, f.default)
    return f.default


def _roster_key(student: Student) -> tuple:
    no = (student.student_no or "").strip()
    if not no:
        return (1, 0, 0, "", student.name)
    # 纯数字学号按数值比较,其余按文本
    return (0, 0, int(no), "", student.name) if no.isdigit() else (0, 1, 0, no, student.name)


def roster(db: Session, cls: SchoolClass) -> list[tuple[Enrollment, Student]]:
    """在籍学生,按学号升序、空学号在后、再按姓名。"""
    rows = db.execute(
        select(Enrollment, Student)
        .join(Student, Student.id == Enrollment.student_id)
        .where(Enrollment.class_id == cls.id, Enrollment.status == "active")
    ).all()
    return sorted(((e, s) for e, s in rows), key=lambda t: _roster_key(t[1]))


def _parse_uuid(raw: Any) -> UUID | None:
    if not isinstance(raw, str):
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


def _active_pair(
    db: Session, cls: SchoolClass, student_id: UUID
) -> tuple[Enrollment, Student] | None:
    row = db.execute(
        select(Enrollment, Student)
        .join(Student, Student.id == Enrollment.student_id)
        .where(
            Enrollment.class_id == cls.id,
            Enrollment.status == "active",
            Student.id == student_id,
        )
    ).first()
    return None if row is None else (row[0], row[1])


def _visible_exam(
    db: Session, cls: SchoolClass, bindings: Sequence[Binding], raw: Any, key: str
) -> Exam:
    exam_id = _parse_uuid(raw)
    if exam_id is None:
        raise _bad(key, "考试不合法")
    try:
        return get_visible_exam(db, cls, exam_id, bindings)
    except ApiError as exc:
        raise _bad(key, "考试不存在或不可见") from exc


def _previous(exams: Sequence[Exam], exam: Exam) -> Exam | None:
    ids = [e.id for e in exams]
    if exam.id not in ids:
        return None
    i = ids.index(exam.id)
    return exams[i - 1] if i > 0 else None


# ---------------------------------------------------------------- 字段校验


def _normalize(
    db: Session,
    bindings: Sequence[Binding],
    cls: SchoolClass,
    template: Template,
    values: dict[str, Any],
) -> dict[str, Any]:
    access = Access.of(bindings, class_scope_of(cls))
    defaults = field_defaults(db, bindings, cls)
    exams = _visible_exams(db, cls, access)
    out: dict[str, Any] = {}
    exam: Exam | None = None
    for f in template.fields:
        raw = values.get(f.key)
        blank = raw is None or (isinstance(raw, str) and not raw.strip())
        if f.type in ("text", "textarea"):
            if not blank and not isinstance(raw, str):
                raise _bad(f.key, f"{f.label}格式不对")
            value = raw.strip() if isinstance(raw, str) else ""
            if not value:
                default = effective_default(f, defaults)
                value = default if isinstance(default, str) else ""
            limit = TEXT_MAX if f.type == "text" else TEXTAREA_MAX
            if f.required and not value:
                raise _bad(f.key, f"请填写{f.label}")
            if len(value) > limit:
                raise _bad(f.key, f"{f.label}不能超过 {limit} 字")
            out[f.key] = value
        elif f.type == "select":
            if blank:
                value = f.default
            elif isinstance(raw, str) and f.options and raw.strip() in f.options:
                value = raw.strip()
            else:
                raise _bad(f.key, f"{f.label}的选项不合法")
            out[f.key] = value
        elif f.type == "check":
            if raw is None:
                out[f.key] = bool(f.default)
            elif isinstance(raw, bool):
                out[f.key] = raw
            else:
                raise _bad(f.key, f"{f.label}格式不对")
        elif f.type == "student":
            sid = _parse_uuid(raw)
            if sid is None or _active_pair(db, cls, sid) is None:
                raise _bad(f.key, "请选择本班的学生")
            out[f.key] = str(sid)
        elif f.type == "students":
            if not isinstance(raw, list) or not raw:
                raise _bad(f.key, "请至少选择一位学生")
            ids = [_parse_uuid(x) for x in raw]
            if len(ids) > STUDENTS_MAX or len(set(ids)) != len(ids) or None in ids:
                raise _bad(f.key, f"学生需为 1–{STUDENTS_MAX} 位本班在籍、不重复的同学")
            chosen = {s.id for _, s in roster(db, cls)}
            if not set(ids) <= chosen:
                raise _bad(f.key, "有学生不在本班")
            out[f.key] = [str(s.id) for _, s in roster(db, cls) if s.id in set(ids)]
        elif f.type == "exam":
            if blank:
                if f.required:
                    raise _bad(f.key, "请选择考试")
                latest = exams[-1] if exams else None
                out[f.key] = str(latest.id) if latest else None
                if f.key == "exam":
                    exam = latest
            else:
                picked = _visible_exam(db, cls, bindings, raw, f.key)
                out[f.key] = str(picked.id)
                if f.key == "exam":
                    exam = picked
        elif f.type == "exam0":
            if f.key not in values:
                prev = _previous(exams, exam) if exam else None
                out[f.key] = str(prev.id) if prev else None
            elif blank:
                out[f.key] = None
            else:
                out[f.key] = str(_visible_exam(db, cls, bindings, raw, f.key).id)
    if template.id == "parent-batch" and out["exam"] == out["vs"]:
        raise _bad("vs", "对比考试不能与所选考试相同")
    if template.id == "report" and out["vs"] is not None and out["vs"] == out["exam"]:
        raise _bad("vs", "对比考试不能与所选考试相同")
    return out


def _normalize_chat(
    db: Session,
    bindings: Sequence[Binding],
    cls: SchoolClass,
    req: AiRequestIn,
) -> dict[str, Any]:
    text = (req.text or "").strip()
    if not text or len(text) > CHAT_TEXT_MAX:
        raise _bad("text", f"请输入 1–{CHAT_TEXT_MAX} 字的内容")
    ctx = req.context
    student_id = ctx.student_id if ctx else None
    exam_id = ctx.exam_id if ctx else None
    if student_id is not None and _active_pair(db, cls, student_id) is None:
        raise _bad("context", "学生不在本班")
    if exam_id is not None:
        try:
            get_visible_exam(db, cls, exam_id, bindings)
        except ApiError as exc:
            raise _bad("context", "考试不存在或不可见") from exc
    return {
        "text": text,
        "context": {
            "class": bool(ctx.class_) if ctx else False,
            "student_id": str(student_id) if student_id else None,
            "exam_id": str(exam_id) if exam_id else None,
        },
    }


# ---------------------------------------------------------------- 标题


def _clip(text: str, limit: int = TITLE_TEXT_MAX) -> str:
    text = text.strip()
    return text if len(text) <= limit else text[:limit] + "…"


def _title(template: Template, params: dict[str, Any], names: dict[str, str], n: int | None) -> str:
    t, p = template.id, params
    key: str
    if t in ("lesson", "ppt"):
        key = f"{p['subject']}《{p['topic']}》"
    elif t == "homework":
        key = f"{p['subject']}「{p['topic']}」"
    elif t == "meeting":
        key = p["theme"]
    elif t == "activity":
        key = p["name"]
    elif t == "summary":
        key = p["kind"]
    elif t == "notice":
        key = _clip(p["matter"])
    elif t in ("parent", "talk", "birthday", "comment1"):
        key = names["student"]
    elif t in ("pmeeting", "report"):
        key = names.get("exam", "")
    elif t == "comments":
        key = f"{n} 位同学"
    else:  # parent-batch
        key = f"{names['exam']} · {n} 位同学"
    return f"{template.title} · {key}" if key else template.title


# ---------------------------------------------------------------- 组装


def _finish(db: Session, cls: SchoolClass, text: str, masked: bool, masker: Masker | None) -> str:
    text = scrub(text)
    if not masked:
        return text
    return (masker or masker_for_class(db, cls.id)).mask(text)


def _exam_name(db: Session, exam_id: str | None) -> str:
    exam = db.get(Exam, UUID(exam_id)) if exam_id else None
    return exam.name if exam else ""


def build_job(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    cls: SchoolClass,
    template: Template | None,
    params: dict[str, Any],
    student: Student | None,
    today: date,
    *,
    masked: bool = False,
    masker: Masker | None = None,
    regress_n: int | None = None,
) -> Job:
    """按已规范化的 ``params`` 和当前数据重建一条 prompt。

    ``template`` 为 None = 自由对话(``params`` 为 ``{text, context}``)。单生模板 / 自由对话在
    ``student`` 为 None 时取 ``params`` 里的学生;批量(comments)必须传 ``student``。
    """
    scope = class_scope_of(cls)
    access = Access.of(bindings, scope)
    sections: list[str] = []
    student_ids: list[UUID] = []
    enrollment: Enrollment | None = None

    if template is None:
        ctx = params["context"]
        contexts = {
            "class": bool(ctx["class"]),
            "student": ctx["student_id"] is not None or student is not None,
            "exam": ctx["exam_id"] is not None,
        }
        sid_raw = ctx["student_id"]
        exam_raw = ctx["exam_id"]
    else:
        contexts = {c: c in template.contexts for c in CONTEXT_ORDER}
        if template.id == "meeting":
            contexts["class"] = bool(params.get("use_class"))
        sid_raw = params.get("student")
        exam_raw = params.get("exam")

    if contexts.get("class"):
        sections.append(class_context(db, cls, access, today))
    if contexts.get("student"):
        if student is None:
            sid = _parse_uuid(sid_raw)
            pair = _active_pair(db, cls, sid) if sid else None
            if pair is None:
                raise _bad("student", "学生不在本班")
            student = pair[1]
        pair = _active_pair(db, cls, student.id)
        if pair is None:
            raise _bad("student", "学生不在本班")
        enrollment = pair[0]
        sections.append(student_context(db, student, enrollment, access, today))
        student_ids.append(student.id)

    exams = _visible_exams(db, cls, access)
    if template is None:
        if exam_raw and access.exam:
            exam = get_visible_exam(db, cls, UUID(exam_raw), bindings)
            sections.append(exam_context(db, cls, exam, _previous(exams, exam), access))
    else:
        if contexts.get("exam") and exam_raw and access.exam:
            exam = get_visible_exam(db, cls, UUID(exam_raw), bindings)
            if "vs" in params:
                compare = (
                    get_visible_exam(db, cls, UUID(params["vs"]), bindings)
                    if params["vs"]
                    else None
                )
            else:
                compare = _previous(exams, exam)
            sections.append(exam_context(db, cls, exam, compare, access))
        if contexts.get("latest_exam") and exams and access.exam:
            latest = exams[-1]
            sections.append(exam_context(db, cls, latest, _previous(exams, latest), access))

    body = "\n\n".join(s for s in sections if s)
    if template is None:
        asked = params["text"]
        text = f"{body}\n\n【老师的要求】\n{asked}" if body else asked
        note = None
    else:
        extra: dict[str, Any] = {"stage": _stage_label(db, cls)}
        note = None
        if template.id == "parent-batch":
            exam = get_visible_exam(db, cls, UUID(params["exam"]), bindings)
            vs = get_visible_exam(db, cls, UUID(params["vs"]), bindings)
            n = regress_n
            if n is None:
                found = regressed_students(db, cls, exam, vs, access)
                n = next((k for e, k in found if enrollment and e.id == enrollment.id), 0)
            extra.update(exam=exam.name, vs=vs.name, n=n)
            note = f"退步 {n} 名"
        task = task_text(template.id, params, extra)
        text = f"{body}\n\n【任务】\n{task}" if body else task

    sent = _finish(db, cls, text, masked, masker)
    return Job(
        sent=sent,
        student_id=student.id if student else None,
        enrollment_id=enrollment.id if enrollment else None,
        note=note,
        student_ids=student_ids,
    )


def _check_perms(
    db: Session,
    request: Request | None,
    user: User,
    bindings: Sequence[Binding],
    cls: SchoolClass,
    needs: frozenset[Perm],
) -> None:
    scope = class_scope_of(cls)
    for perm in PERM_ORDER:
        if perm in needs and not can(bindings, perm, scope):
            deny(
                db,
                user_id=user.id,
                action=perm.value,
                object_type="class",
                object_id=str(cls.id),
                request=request,
            )


def resolve(
    db: Session,
    user: User,
    bindings: Sequence[Binding],
    cls: SchoolClass,
    req: AiRequestIn,
    cfg: AIConfig | None,
    today: date,
    *,
    request: Request | None = None,
) -> Resolved:
    template: Template | None = None
    if req.template_id is not None:
        template = TEMPLATES.get(req.template_id)
        if template is None:
            raise _bad("template_id", "模板不存在")
    needs = template.needs if template else frozenset({Perm.AI_USE})
    _check_perms(db, request, user, bindings, cls, needs)

    masked = bool(cfg.mask_forced if cfg else False) or req.mask
    masker = masker_for_class(db, cls.id)
    system = scrub(system_prompt(db, user, bindings, cls))

    def make(params: dict[str, Any], student: Student | None, n: int | None = None) -> Job:
        return build_job(
            db, user, bindings, cls, template, params, student, today,
            masked=masked, masker=masker, regress_n=n,
        )  # fmt: skip

    if template is None:
        params = _normalize_chat(db, bindings, cls, req)
        job = make(params, None)
        return Resolved(
            template=None,
            title=_clip(params["text"]),
            show=params["text"],
            params=params,
            student_id=job.student_id,
            save_as=None,
            batch_only=False,
            masked=masked,
            masker=masker,
            system=system,
            jobs=[job],
        )

    params = _normalize(db, bindings, cls, template, req.values)
    names: dict[str, str] = {}
    if "exam" in params:
        names["exam"] = _exam_name(db, params["exam"])
    jobs: list[Job]
    student_id: UUID | None = None
    if template.id == "comments":
        by_id = {str(s.id): s for _, s in roster(db, cls)}
        jobs = []
        for sid in params["students"]:
            s = by_id[sid]
            jobs.append(make(params, s))
        title = _title(template, params, names, len(jobs))
    elif template.id == "parent-batch":
        access = Access.of(bindings, class_scope_of(cls))
        exam = get_visible_exam(db, cls, UUID(params["exam"]), bindings)
        vs = get_visible_exam(db, cls, UUID(params["vs"]), bindings)
        found = regressed_students(db, cls, exam, vs, access)
        if not found:
            raise ApiError(400, "AI_NO_TARGETS", "没有退步 5 名及以上的同学")
        jobs = [make(params, db.get(Student, e.student_id), n) for e, n in found]
        title = _title(template, params, names, len(jobs))
    else:
        if "student" in params:
            pair = _active_pair(db, cls, UUID(params["student"]))
            assert pair is not None
            names["student"] = pair[1].name
            student_id = pair[1].id
        jobs = [make(params, None)]
        title = _title(template, params, names, None)
    return Resolved(
        template=template,
        title=title,
        show=title,
        params=params,
        student_id=student_id,
        save_as=template.save_as,
        batch_only=template.batch,
        masked=masked,
        masker=masker,
        system=system,
        jobs=jobs,
    )


def combined_prompt(r: Resolved) -> str:
    if r.template is not None and r.template.batch:
        parts = [r.system, BATCH_INTRO.format(n=len(r.jobs))]
        parts.extend(f"=== 第 {i} 位 ===\n{j.sent}" for i, j in enumerate(r.jobs, 1))
        return "\n\n".join(parts)
    return r.system + "\n\n" + r.jobs[0].sent
