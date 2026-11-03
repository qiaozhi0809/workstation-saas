from datetime import date
from uuid import UUID

from app.ai.requests import build_job, roster
from app.ai.settings import AIConfig, save_ai_config
from app.ai.templates import TEMPLATES
from app.domain.classes.service import class_scope_of
from app.models import Exam, SchoolClass, Score, Student, User
from app.rbac.bindings import load_bindings
from tests.factories import make_class, make_student
from tests.helpers import audit_rows, auth, enrollment_of
from tests.seed_ids import (
    ASSISTANT_USER_ID,
    CLASS_ID,
    EXAM_IDS,
    STUDENT_IDS,
    SUBJECT_USER_ID,
    TEACHER_USER_ID,
    YEAR_ID,
)

PROMPT = "/api/v1/ai/prompt"
SYSTEM_HEAD = "你是一位熟悉中国中小学教育的班主任助手"


def post(client, settings, body, user_id=TEACHER_USER_ID):
    return client.post(PROMPT, json={"class_id": CLASS_ID, **body}, headers=auth(settings, user_id))


def _compare_exam(db) -> Exam:
    """自造对比考试:期中第 7 名的张小三在这里是第 1 名 → 退 6 名。"""
    cls = db.get(SchoolClass, UUID(CLASS_ID))
    exam = Exam(
        class_id=cls.id,
        academic_year_id=cls.academic_year_id,
        name="摸底",
        exam_type="其他",
        date=date(2026, 9, 20),
        subjects=[{"name": "语文", "full": 100}],
    )
    db.add(exam)
    db.flush()
    for rank, idx in enumerate([2, 7, 0, 1, 9, 5, 3, 8, 6, 4]):
        db.add(
            Score(
                exam_id=exam.id,
                enrollment_id=enrollment_of(db, STUDENT_IDS[idx]),
                subject="语文",
                value=100 - rank,
            )
        )
    db.flush()
    return exam


def test_templates_listed_with_availability(client, settings):
    r = client.get(
        f"/api/v1/ai/templates?class_id={CLASS_ID}", headers=auth(settings, SUBJECT_USER_ID)
    )
    items = {t["id"]: t for t in r.json()["items"]}
    assert len(items) == 15 and items["lesson"]["available"] and items["report"]["available"]
    assert items["parent"]["available"] is False
    assert items["parent"]["unavailable_reason"] == "仅班主任可用"
    assert items["lesson"]["unavailable_reason"] is None
    assert [c["id"] for c in r.json()["categories"]] == ["rec", "teach", "manage", "home", "grow"]
    lesson = {f["key"]: f for f in items["lesson"]["fields"]}
    assert lesson["subject"]["default"] == "数学" and lesson["grade"]["default"]
    assert lesson["hours"]["options"] == ["1 课时", "2 课时", "3 课时"]
    assert lesson["hours"]["default"] == "1 课时" and lesson["topic"]["required"] is True
    assert items["comment1"]["hidden"] and items["parent-batch"]["batch"]


def test_templates_reason_for_missing_exam_read(client, settings):
    r = client.get(
        f"/api/v1/ai/templates?class_id={CLASS_ID}", headers=auth(settings, ASSISTANT_USER_ID)
    )
    items = {t["id"]: t for t in r.json()["items"]}
    assert items["report"]["available"] is False
    assert items["report"]["unavailable_reason"] == "需要查看成绩的权限"


def test_report_denied_for_assistant(client, settings, db):
    r = post(
        client,
        settings,
        {"template_id": "report", "values": {"exam": EXAM_IDS[1]}},
        ASSISTANT_USER_ID,
    )
    assert r.status_code == 403 and r.json()["error"]["code"] == "FORBIDDEN"
    rows = [a for a in audit_rows(db, CLASS_ID) if a.action == "exam.read"]
    assert rows and rows[0].success is False


def test_homeroom_only_template_denied_for_subject_teacher(client, settings, db):
    body = {"template_id": "parent", "values": {"student": STUDENT_IDS[0]}}
    r = post(client, settings, body, SUBJECT_USER_ID)
    assert r.status_code == 403
    rows = [a for a in audit_rows(db, CLASS_ID) if a.action == "ai.class"]
    assert rows and rows[0].success is False


def test_prompt_masks_and_maps(client, settings):
    body = {
        "template_id": "parent",
        "values": {
            "student": STUDENT_IDS[0],
            "detail": "王小一和李小二吵架,家长电话 13800000011",
        },
        "mask": True,
    }
    r = post(client, settings, body).json()
    assert "王小一" not in r["prompt"] and "李小二" not in r["prompt"]
    assert "13800000011" not in r["prompt"]
    assert "【学生01】" in r["prompt"]
    assert {"code": "【学生01】", "name": "王小一"} in r["mapping"]
    assert r["prompt"].startswith(SYSTEM_HEAD)
    assert "【学生档案】" in r["prompt"] and "【任务】" in r["prompt"]


def test_prompt_unmasked_has_names_but_no_phone(client, settings):
    body = {
        "template_id": "parent",
        "values": {"student": STUDENT_IDS[0], "detail": "家长电话 13800000011"},
        "mask": False,
    }
    r = post(client, settings, body).json()
    assert "王小一" in r["prompt"] and "13800000011" not in r["prompt"]
    assert r["mapping"] == []


def test_mask_forced_overrides_request(client, settings, db):
    cfg = AIConfig(
        provider="deepseek",
        base_url="https://api.deepseek.com",
        model="deepseek-chat",
        temperature=0.7,
        api_key="sk-test-0000",
        mask_forced=True,
    )
    save_ai_config(db, settings.school_id, settings.master_key_bytes, cfg)
    db.commit()
    body = {"template_id": "talk", "values": {"student": STUDENT_IDS[0]}, "mask": False}
    r = post(client, settings, body).json()
    assert "王小一" not in r["prompt"] and "【学生01】" in r["prompt"]


def test_field_validation(client, settings, db):
    def field_of(body, user=TEACHER_USER_ID):
        r = post(client, settings, body, user)
        assert r.status_code == 400 and r.json()["error"]["code"] == "AI_FIELD_INVALID", r.text
        return r.json()["error"]["details"]["field"]

    assert field_of({"template_id": "lesson", "values": {"subject": "数学"}}) == "topic"
    other = make_class(db, "三年三班")
    stranger = make_student(db, other, "外班生", "wbs")
    db.commit()
    assert field_of({"template_id": "parent", "values": {"student": str(stranger)}}) == "student"
    assert field_of({"template_id": "parent", "values": {"student": "不是id"}}) == "student"
    bad_select = {"template_id": "lesson", "values": {"topic": "分数", "hours": "9 课时"}}
    assert field_of(bad_select) == "hours"
    long_topic = {"template_id": "lesson", "values": {"topic": "长" * 101}}
    assert field_of(long_topic) == "topic"
    assert field_of({"template_id": "comments", "values": {"students": []}}) == "students"
    dup = {"template_id": "comments", "values": {"students": [STUDENT_IDS[0]] * 2}}
    assert field_of(dup) == "students"
    # 任课老师:考试不含数学 → 不可见
    cls = db.get(SchoolClass, UUID(CLASS_ID))
    chinese_only = Exam(
        class_id=cls.id,
        academic_year_id=cls.academic_year_id,
        name="语文测验",
        exam_type="其他",
        date=date(2026, 10, 1),
        subjects=[{"name": "语文", "full": 100}],
    )
    db.add(chinese_only)
    db.commit()
    body = {"template_id": "report", "values": {"exam": str(chinese_only.id)}}
    assert field_of(body, SUBJECT_USER_ID) == "exam"


def test_lesson_defaults_and_task_text(client, settings):
    body = {"template_id": "lesson", "values": {"topic": "分数的初步认识", "extra": "  基础弱  "}}
    r = post(client, settings, body, SUBJECT_USER_ID).json()
    assert (
        "请为小学" in r["prompt"]
        and "数学的课题《分数的初步认识》编写一份完整的教学设计（1 课时）" in r["prompt"]
    )
    assert "学情与要求：基础弱" in r["prompt"] and "【任务】" not in r["prompt"]
    no_extra = post(
        client, settings, {"template_id": "lesson", "values": {"topic": "分数"}}, SUBJECT_USER_ID
    )
    assert "学情与要求" not in no_extra.json()["prompt"]


def test_optional_text_becomes_tbd(client, settings):
    body = {"template_id": "activity", "values": {"name": "春游"}}
    r = post(client, settings, body).json()
    assert "时间地点：未定；参与人员：未定；预算：未定。" in r["prompt"]
    assert "【班级概况】" in r["prompt"]


def test_free_chat_context_flags(client, settings):
    body = {
        "template_id": None,
        "text": "帮我写家长会开场白",
        "context": {"class": True, "student_id": STUDENT_IDS[0], "exam_id": EXAM_IDS[1]},
        "values": {},
        "mask": False,
    }
    p = post(client, settings, body).json()["prompt"]
    order = [p.index(k) for k in ("【班级概况】", "【学生档案】", "【考试数据】", "【老师的要求】")]
    assert order == sorted(order)
    assert p.endswith("【老师的要求】\n帮我写家长会开场白")


def test_free_chat_validation(client, settings):
    for text in (None, "   ", "字" * 4001):
        r = post(client, settings, {"template_id": None, "text": text})
        assert r.status_code == 400
        assert r.json()["error"]["details"]["field"] == "text"
    unknown = "a0000099-0000-0000-0000-000000000099"
    for ctx in ({"student_id": unknown}, {"exam_id": unknown}):
        r = post(client, settings, {"template_id": None, "text": "你好", "context": ctx})
        assert r.status_code == 400 and r.json()["error"]["details"]["field"] == "context"


def test_free_chat_context_clipped_for_subject_teacher(client, settings):
    body = {
        "template_id": None,
        "text": "看看",
        "context": {"class": False, "student_id": STUDENT_IDS[0], "exam_id": EXAM_IDS[1]},
    }
    p = post(client, settings, body, SUBJECT_USER_ID).json()["prompt"]
    assert "家庭" not in p and "语文" not in p


def test_batch_comments_combined_prompt(client, settings):
    ids = [STUDENT_IDS[2], STUDENT_IDS[0], STUDENT_IDS[1]]
    r = post(client, settings, {"template_id": "comments", "values": {"students": ids}}).json()
    p = r["prompt"]
    assert "下面是 3 位同学的资料" in p and "=== 第 3 位 ===" in p and "=== 第 1 位 ===" in p
    assert p.startswith(SYSTEM_HEAD)
    assert p.count("请为这位同学写一段期末评语") == 3


def test_parent_batch_no_targets(client, settings):
    body = {"template_id": "parent-batch", "values": {"exam": EXAM_IDS[1], "vs": EXAM_IDS[0]}}
    r = post(client, settings, body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "AI_NO_TARGETS"


def test_parent_batch_targets_and_params(db, client, settings):
    compare = _compare_exam(db)
    db.commit()
    body = {"template_id": "parent-batch", "values": {"exam": EXAM_IDS[1], "vs": str(compare.id)}}
    r = post(client, settings, body).json()
    assert "=== 第 1 位 ===" in r["prompt"] and "下面是 1 位同学的资料" in r["prompt"]
    assert "后退了 6 名" in r["prompt"] and "「摸底」" in r["prompt"]


def test_resolve_contract(db):
    from app.ai.requests import combined_prompt, resolve
    from app.domain.ai.schemas import AiRequestIn

    cls = db.get(SchoolClass, UUID(CLASS_ID))
    user = db.get(User, UUID(TEACHER_USER_ID))
    bindings = load_bindings(db, user.id, UUID(YEAR_ID))
    today = date(2026, 11, 2)
    ids = [STUDENT_IDS[1], STUDENT_IDS[0]]
    req = AiRequestIn(class_id=cls.id, template_id="comments", values={"students": ids}, mask=True)
    r = resolve(db, user, bindings, cls, req, None, today)
    assert r.batch_only and r.save_as == "comment" and r.masked and r.student_id is None
    assert r.title == "期末评语(批量) · 2 位同学" and r.show == r.title
    assert len(r.jobs) == 2 and all(len(j.student_ids) == 1 for j in r.jobs)
    assert r.jobs[0].enrollment_id and r.jobs[0].note is None
    # 逐人按班级花名册顺序,params 可 JSON 序列化
    assert [str(j.student_id) for j in r.jobs] == [
        str(s.id) for _, s in roster(db, cls) if str(s.id) in ids
    ]
    assert r.params["style"] == "温暖鼓励" and r.params["students"] == [
        str(j.student_id) for j in r.jobs
    ]
    import json

    json.dumps(r.params)
    assert combined_prompt(r).startswith(SYSTEM_HEAD)
    # 从 params + 学生重建
    s = db.get(Student, r.jobs[1].student_id)
    job = build_job(
        db, user, bindings, cls, TEMPLATES["comments"], r.params, s, today,
        masked=True, masker=r.masker,
    )  # fmt: skip
    assert job.sent == r.jobs[1].sent and s.name not in job.sent
    # 单生模板
    one = resolve(
        db, user, bindings, cls,
        AiRequestIn(class_id=cls.id, template_id="birthday", values={"student": STUDENT_IDS[0]}),
        None, today,
    )  # fmt: skip
    assert one.student_id == UUID(STUDENT_IDS[0]) and one.title == "生日祝福 · 王小一"
    assert len(one.jobs) == 1 and one.jobs[0].student_ids == [UUID(STUDENT_IDS[0])]
    assert class_scope_of(cls)


def test_pmeeting_and_report_derive_defaults(db):
    from app.ai.requests import resolve
    from app.domain.ai.schemas import AiRequestIn

    cls = db.get(SchoolClass, UUID(CLASS_ID))
    user = db.get(User, UUID(TEACHER_USER_ID))
    bindings = load_bindings(db, user.id, UUID(YEAR_ID))
    today = date(2026, 11, 2)

    def run(tid, values):
        req = AiRequestIn(class_id=cls.id, template_id=tid, values=values)
        return resolve(db, user, bindings, cls, req, None, today)

    p = run("pmeeting", {})
    assert p.params["exam"] == EXAM_IDS[1] and p.params["mins"] == "10 分钟"
    assert p.title.startswith("家长会发言稿 · ")
    rep = run("report", {"exam": EXAM_IDS[1]})
    assert rep.params["vs"] == EXAM_IDS[0]
    assert run("report", {"exam": EXAM_IDS[1], "vs": None}).params["vs"] is None
    assert run("report", {"exam": EXAM_IDS[0]}).params["vs"] is None


def test_prompt_copy_audited(client, settings, db):
    body = {
        "template_id": "parent",
        "values": {"student": STUDENT_IDS[0], "detail": "秘密内容"},
        "mask": True,
    }
    r = post(client, settings, body).json()
    rows = [a for a in audit_rows(db, CLASS_ID) if a.action == "ai.prompt_copy"]
    assert len(rows) == 1 and rows[0].success and rows[0].object_type == "class"
    extra = rows[0].extra
    assert extra["student_ids"] == [STUDENT_IDS[0]] and extra["masked"] is True
    assert extra["template"] == "parent" and extra["chars_out"] == 0
    assert extra["chars_in"] == len(r["prompt"]) and "秘密内容" not in str(extra)


def test_prompt_works_without_ai_config(client, settings):
    r = post(client, settings, {"template_id": "ppt", "values": {"topic": "光合作用"}})
    assert r.status_code == 200 and "光合作用" in r.json()["prompt"]
