"""学校及格 / 优秀线与科目目录(M5d 段 A1)。

读写接口、三处口径贯通、改目录不追溯已有班级、并发合并科目、联考科目必须在目录里。
"""

import threading
from datetime import date
from uuid import UUID

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ai.context import Access, class_context, exam_context, load_exam_data
from app.ai.stats import exam_stats
from app.domain.classes.service import class_scope_of
from app.domain.classes.sort import class_sort_key
from app.domain.exams.schemas import SubjectFull
from app.domain.exams.subjects import PRESETS, merge_subjects
from app.domain.school_settings.service import DEFAULT_GRADING, get_catalog, get_grading
from app.errors import ApiError
from app.models import Exam, Grade, GradeExam, SchoolClass, Score
from app.models.audit import AuditLog
from app.rbac.bindings import load_bindings
from tests.factories import make_class
from tests.helpers import auth, enrollment_of
from tests.seed_ids import (
    ASSISTANT_USER_ID,
    CLASS_ID,
    EXAM_IDS,
    GRADE_ID,
    SCHOOL_ID,
    STUDENT_IDS,
    TEACHER_USER_ID,
    YEAR_ID,
)

GRADING = "/api/v1/school/grading"
CATALOG = "/api/v1/school/subject-catalog"
SAVE_GRADING = "/api/v1/admin/settings/grading"
SAVE_CATALOG = "/api/v1/admin/settings/subject-catalog"
GE_API = "/api/v1/admin/grade-exams"
SUBJECTS = f"/api/v1/classes/{CLASS_ID}/subjects"
EXAMS = f"/api/v1/classes/{CLASS_ID}/exams"
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
PARENT = "55555555-5555-5555-5555-555555555561"  # 李家长:只有家长身份
DEFAULT_CATALOG = {stage: [s.model_dump() for s in subs] for stage, subs in PRESETS.items()}


def _ge_body(subjects, name="期中联考"):
    return {
        "grade_id": GRADE_ID,
        "name": name,
        "exam_type": "期中",
        "date": "2026-11-10",
        "subjects": subjects,
    }


def _exam_body(subjects, name="小测"):
    return {"name": name, "exam_type": "周测", "date": "2026-11-02", "subjects": subjects}


def _teacher_access(db):
    cls = db.get(SchoolClass, UUID(CLASS_ID))
    bindings = load_bindings(db, UUID(TEACHER_USER_ID), UUID(YEAR_ID))
    return cls, Access.of(bindings, class_scope_of(cls))


def test_defaults(client, settings, db):
    r = client.get(GRADING, headers=auth(settings))
    assert r.status_code == 200, r.text
    assert r.json() == {"pass_ratio": 0.6, "good_ratio": 0.85}
    r = client.get(CATALOG, headers=auth(settings))
    assert r.status_code == 200, r.text
    assert r.json() == DEFAULT_CATALOG
    assert r.json()["primary"][-1] == {"name": "道法", "full": 100}
    assert client.get(GRADING).status_code == 401
    assert client.get(CATALOG).status_code == 401
    assert get_grading(db, UUID(SCHOOL_ID)) == DEFAULT_GRADING
    catalog = get_catalog(db, UUID(SCHOOL_ID))
    assert catalog == PRESETS
    catalog["primary"].append(SubjectFull(name="书法", full=50))
    assert len(PRESETS["primary"]) == 5  # 返回的是副本,改了不影响内置预设


def test_save_validates_ranges(client, settings, db):
    h = auth(settings, IT_ADMIN)
    bad = [
        {"pass_ratio": 0.7, "good_ratio": 0.7},  # 优秀线必须高于及格线
        {"pass_ratio": 0.8, "good_ratio": 0.7},
        {"pass_ratio": 0.29, "good_ratio": 0.85},  # 及格 0.30–0.95
        {"pass_ratio": 0.96, "good_ratio": 0.97},
        {"pass_ratio": 0.3, "good_ratio": 0.39},  # 优秀 0.40–1.00
        {"pass_ratio": 0.6, "good_ratio": 1.01},
        {"pass_ratio": 0.605, "good_ratio": 0.85},  # 只允许两位小数
        {"pass_ratio": 0.6, "good_ratio": 0.851},
        {"pass_ratio": 0.6},
    ]
    for body in bad:
        r = client.put(SAVE_GRADING, headers=h, json=body)
        assert r.status_code == 400, body
        assert r.json()["error"]["code"] == "BAD_REQUEST"
    assert client.get(GRADING, headers=h).json() == {"pass_ratio": 0.6, "good_ratio": 0.85}
    # 边界值可以存
    edge = {"pass_ratio": 0.3, "good_ratio": 1.0}
    assert client.put(SAVE_GRADING, headers=h, json=edge).json() == edge
    ok = {"pass_ratio": 0.7, "good_ratio": 0.9}
    r = client.put(SAVE_GRADING, headers=h, json=ok)
    assert r.status_code == 200, r.text
    assert r.json() == ok
    assert client.get(GRADING, headers=auth(settings)).json() == ok
    audits = db.scalars(select(AuditLog).where(AuditLog.action == "settings.grading_update")).all()
    assert len(audits) == 2
    assert audits[0].success is True and audits[0].object_type == "school_setting"
    # 没有 settings.manage 的教导主任不能改,被拒落审计
    r = client.put(SAVE_GRADING, headers=auth(settings, DEAN), json=ok)
    assert r.status_code == 403
    denied = db.scalars(select(AuditLog).where(AuditLog.success.is_(False))).all()
    assert [a.action for a in denied] == ["settings.manage"]


def test_catalog_save_validates(client, settings, db):
    h = auth(settings, IT_ADMIN)
    primary = DEFAULT_CATALOG["primary"]
    bad_primaries = [
        [],
        [{"name": f"科{i}", "full": 10} for i in range(21)],
        [*primary, {"name": "语文", "full": 50}],  # 重名
        [*primary, {"name": "一二三四五六七八九十一", "full": 50}],
        [*primary, {"name": "书法", "full": 0}],
        [*primary, {"name": "书法", "full": 1001}],
        [*primary, {"name": "   ", "full": 50}],
    ]
    for bad in bad_primaries:
        r = client.put(SAVE_CATALOG, headers=h, json={**DEFAULT_CATALOG, "primary": bad})
        assert r.status_code == 400, bad
    r = client.put(SAVE_CATALOG, headers=h, json={"primary": primary})  # 三个学段都要给
    assert r.status_code == 400
    assert client.get(CATALOG, headers=h).json() == DEFAULT_CATALOG
    new = {**DEFAULT_CATALOG, "primary": [*primary, {"name": " 书法 ", "full": 50}]}
    r = client.put(SAVE_CATALOG, headers=h, json=new)
    assert r.status_code == 200, r.text
    assert r.json()["primary"][-1] == {"name": "书法", "full": 50}
    assert client.get(CATALOG, headers=auth(settings)).json() == r.json()
    audit = db.scalars(
        select(AuditLog).where(AuditLog.action == "settings.subject_catalog_update")
    ).one()
    assert audit.success is True and audit.object_type == "school_setting"
    assert client.put(SAVE_CATALOG, headers=auth(settings, DEAN), json=new).status_code == 403


def test_ratios_flow_to_ai_and_reports(client, settings, db):
    """校长把及格线改成 70%(优秀 90%)后,统计函数、AI 上下文、成绩汇总接口都按新比例。"""
    r = client.put(
        SAVE_GRADING, headers=auth(settings, IT_ADMIN), json={"pass_ratio": 0.7, "good_ratio": 0.9}
    )
    assert r.status_code == 200, r.text
    cls, access = _teacher_access(db)
    mid = db.get(Exam, UUID(EXAM_IDS[1]))
    ratios = get_grading(db, cls.school_id)
    assert (ratios.pass_ratio, ratios.good_ratio) == (0.7, 0.9)
    # 1) 统计函数:期中总分 300,及格线 180 → 210 后 9/10 变 8/10;优秀线 255 → 270 后 5/10 变 3/10
    st = exam_stats(*load_exam_data(db, cls, mid, access), ratios=ratios)
    assert st is not None
    assert (round(st.pass_rate, 2), round(st.good_rate, 2)) == (0.8, 0.3)
    chinese = next(s for s in st.subjects if s.name == "语文")
    assert (chinese.low, chinese.pass_rate, chinese.good_rate) == (2, 0.8, 0.3)  # 62、69 不及格
    # 2) AI 上下文:及格率、不及格人数、两科及以上不及格的名单
    c = exam_context(db, cls, mid, None, access)
    assert "总分：平均 236.1，最高 289，最低 117，及格率 80%，优秀率 30%，标准差 47.7" in c
    assert (
        "- 语文（满分 100）：平均 81.8，得分率 81.8%，及格率 80%，优秀率 30%，"
        "最高 97，最低 62，不及格 2 人"
    ) in c
    assert "- 英语（满分 100）：" in c and "最低 62，不及格 1 人" in c
    assert "两科及以上不及格：周小七、陈小五" in c  # 60% 时只有陈小五
    assert "及格率 80%，优秀率 30%" in class_context(db, cls, access, date(2026, 11, 2))
    # 3) 成绩汇总接口:语文 90 / 65 / 50 / 88 → 60% 时及格 3/4、优秀 2/4;70% / 90% 时 2/4、1/4
    ge = client.post(
        GE_API,
        json=_ge_body([{"name": "语文", "full": 100}, {"name": "数学", "full": 100}]),
        headers=auth(settings, DEAN),
    )
    assert ge.status_code == 201, ge.text
    exam = db.scalars(
        select(Exam).where(Exam.grade_exam_id == UUID(ge.json()["id"]), Exam.class_id == cls.id)
    ).one()
    for idx, value in enumerate([90, 65, 50, 88]):
        db.add(
            Score(
                exam_id=exam.id,
                enrollment_id=enrollment_of(db, STUDENT_IDS[idx]),
                subject="语文",
                value=value,
            )
        )
    db.flush()
    summary = client.get(
        "/api/v1/admin/reports/scores",
        params={"grade_exam_id": ge.json()["id"]},
        headers=auth(settings, DEAN),
    )
    assert summary.status_code == 200, summary.text
    mine = next(c for c in summary.json()["classes"] if c["class_id"] == CLASS_ID)
    stat = next(s for s in mine["subjects"] if s["subject"] == "语文")
    assert (stat["count"], stat["pass_rate"], stat["good_rate"]) == (4, 0.5, 0.25)
    grade_stat = next(s for s in summary.json()["grade"]["subjects"] if s["subject"] == "语文")
    assert (grade_stat["pass_rate"], grade_stat["good_rate"]) == (0.5, 0.25)


def test_catalog_change_does_not_touch_existing_classes(client, settings, db):
    """目录删掉"道法"后,已有班级的"道法"考试与分数照常显示、照常能录(Review Focus 2)。"""
    h = auth(settings)
    r = client.post(EXAMS, json=_exam_body([{"name": "道法", "full": 100}], "道法小测"), headers=h)
    assert r.status_code == 201, r.text
    exam_id = r.json()["id"]
    before = client.get(SUBJECTS, headers=h).json()["items"]
    assert {"name": "道法", "full": 100} in before
    without = {
        **DEFAULT_CATALOG,
        "primary": [s for s in DEFAULT_CATALOG["primary"] if s["name"] != "道法"],
    }
    r = client.put(SAVE_CATALOG, headers=auth(settings, IT_ADMIN), json=without)
    assert r.status_code == 200, r.text
    assert client.get(CATALOG, headers=h).json() == without
    # 班级自己的科目列表、考试科目都不变
    assert client.get(SUBJECTS, headers=h).json()["items"] == before
    items = client.get(EXAMS, headers=h).json()["items"]
    assert next(e for e in items if e["id"] == exam_id)["subjects"] == [
        {"name": "道法", "full": 100}
    ]
    # 照常录分、照常看
    eid = str(enrollment_of(db, STUDENT_IDS[0]))
    r = client.put(
        f"{EXAMS}/{exam_id}/scores",
        json={"cells": [{"enrollment_id": eid, "subject": "道法", "value": 88.0}]},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"updated": 1}
    sheet = client.get(f"{EXAMS}/{exam_id}/scores", headers=h).json()
    assert next(i for i in sheet["items"] if i["enrollment_id"] == eid)["scores"] == {"道法": 88.0}
    # 再建一场"道法"考试也可以(班级科目列表里还有它)
    r = client.post(EXAMS, json=_exam_body([{"name": "道法", "full": 100}], "道法二测"), headers=h)
    assert r.status_code == 201, r.text


def test_new_class_uses_catalog(client, settings, db):
    primary = [
        {"name": "语文", "full": 100},
        {"name": "数学", "full": 100},
        {"name": "书法", "full": 50},
    ]
    r = client.put(
        SAVE_CATALOG, headers=auth(settings, IT_ADMIN), json={**DEFAULT_CATALOG, "primary": primary}
    )
    assert r.status_code == 200, r.text
    r = client.post(
        "/api/v1/admin/classes",
        json={"grade_id": GRADE_ID, "name": "三年三班", "room": "求知楼 203"},
        headers=auth(settings, PRINCIPAL),
    )
    assert r.status_code == 201, r.text
    new_id = r.json()["id"]
    h = auth(settings, PRINCIPAL)
    assert client.get(f"/api/v1/classes/{new_id}/subjects", headers=h).json()["items"] == primary
    # 年级显式设了学段就按学段取目录:三年级标成"初中"后用初中目录
    db.get(Grade, UUID(GRADE_ID)).stage = "初中"
    db.flush()
    got = client.get(f"/api/v1/classes/{new_id}/subjects", headers=h).json()["items"]
    assert got == DEFAULT_CATALOG["junior"]


def test_fill_from_catalog(client, settings, db):
    h = auth(settings)
    url = f"{SUBJECTS}/fill-from-catalog"
    # 班级先有自己的列表:预设 + 书法 20 分(目录外)
    own = [{"name": "科学", "full": 50}, {"name": "书法", "full": 20}]
    r = client.post(EXAMS, json=_exam_body(own), headers=h)
    assert r.status_code == 201, r.text
    assert [s["name"] for s in client.get(SUBJECTS, headers=h).json()["items"]] == [
        "语文",
        "数学",
        "英语",
        "科学",
        "道法",
        "书法",
    ]
    primary = [
        {"name": "语文", "full": 100},
        {"name": "数学", "full": 100},
        {"name": "英语", "full": 100},
        {"name": "科学", "full": 60},  # 目录里改了满分,班级已有的不动
        {"name": "道法", "full": 100},
        {"name": "美术", "full": 30},
        {"name": "音乐", "full": 30},
    ]
    r = client.put(
        SAVE_CATALOG, headers=auth(settings, IT_ADMIN), json={**DEFAULT_CATALOG, "primary": primary}
    )
    assert r.status_code == 200, r.text
    expected = [
        {"name": "语文", "full": 100},
        {"name": "数学", "full": 100},
        {"name": "英语", "full": 100},
        {"name": "科学", "full": 100},
        {"name": "道法", "full": 100},
        {"name": "书法", "full": 20},
        {"name": "美术", "full": 30},
        {"name": "音乐", "full": 30},
    ]
    r = client.post(url, headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == expected
    assert client.get(SUBJECTS, headers=h).json()["items"] == expected
    assert client.post(url, headers=h).json() == expected  # 再补一次没有变化
    # 要本班 exam.write:副班主任被拒并落审计;不存在的班 404
    r = client.post(url, headers=auth(settings, ASSISTANT_USER_ID))
    assert r.status_code == 403
    denied = db.scalars(select(AuditLog).where(AuditLog.success.is_(False))).all()
    assert [(a.action, a.object_id) for a in denied] == [("exam.write", CLASS_ID)]
    missing = "/api/v1/classes/99999999-9999-9999-9999-999999999999/subjects/fill-from-catalog"
    assert client.post(missing, headers=h).status_code == 404


def test_merge_subjects_concurrent(engine):
    """两个事务同时给同一个班各加一门新科目:后到的要等前一个提交,再在新列表上追加,两门都在(L11)。"""
    with Session(engine) as setup:
        cls = SchoolClass(
            school_id=UUID(SCHOOL_ID),
            academic_year_id=UUID(YEAR_ID),
            grade_id=UUID(GRADE_ID),
            name="并发测试班",
            subjects=[{"name": "语文", "full": 100}],
        )
        setup.add(cls)
        setup.commit()
        cid = cls.id
    a, b = Session(engine), Session(engine)
    done = threading.Event()

    def other():
        try:
            merge_subjects(b, b.get(SchoolClass, cid), [SubjectFull(name="美术", full=30)])
            b.commit()
        finally:
            done.set()

    t = threading.Thread(target=other)
    try:
        # A 先合并、持锁不提交;B 随后要等 A 提交
        merge_subjects(a, a.get(SchoolClass, cid), [SubjectFull(name="书法", full=20)])
        t.start()
        blocked = not done.wait(0.5)
        a.commit()
        t.join(5)
        assert blocked, "后到的事务没有等前一个提交就写了"
        assert done.is_set()
        with Session(engine) as check:
            names = [s["name"] for s in check.get(SchoolClass, cid).subjects]
        assert names == ["语文", "书法", "美术"]
    finally:
        a.close()
        if t.is_alive():
            t.join(5)
        b.close()
        with Session(engine) as cleanup:
            cleanup.execute(delete(SchoolClass).where(SchoolClass.id == cid))
            cleanup.commit()


def test_merge_subjects_on_deleted_class_is_404(db):
    cid = make_class(db, "待删班")
    cls = db.get(SchoolClass, cid)
    db.execute(delete(SchoolClass).where(SchoolClass.id == cid))
    with pytest.raises(ApiError) as err:
        merge_subjects(db, cls, [SubjectFull(name="书法", full=20)])
    assert (err.value.status, err.value.code) == (404, "NOT_FOUND")


def _class_with_id(db, class_id: str, name: str) -> UUID:
    cls = SchoolClass(
        id=UUID(class_id),
        school_id=UUID(SCHOOL_ID),
        academic_year_id=UUID(YEAR_ID),
        grade_id=UUID(GRADE_ID),
        name=name,
    )
    db.add(cls)
    db.flush()
    return cls.id


def test_grade_exam_locks_classes_in_id_order(client, settings, db, monkeypatch):
    """建 / 改 / 同步联考会锁同年级多个班的行:三条路径都按班级 id 升序(同学年升级、课表导入)。"""
    import app.domain.grade_exams.service as ge_service

    seen: list[UUID] = []
    real = ge_service.merge_subjects

    def spy(db_, cls, subjects):
        seen.append(cls.id)
        return real(db_, cls, subjects)

    monkeypatch.setattr(ge_service, "merge_subjects", spy)
    h = auth(settings, DEAN)
    # 班名序与 id 序相反:〇 < 一 < 二,但 id 最大
    top = _class_with_id(db, "ffffffff-ffff-ffff-ffff-ffffffffffff", "三年〇班")
    r = client.post(GE_API, json=_ge_body([{"name": "语文", "full": 100}]), headers=h)
    assert r.status_code == 201, r.text
    assert [c["class_name"] for c in r.json()["classes"]] == ["三年〇班", "三年一班", "三年二班"]
    assert seen == sorted(seen) and seen[-1] == top and len(seen) == 3
    seen.clear()
    ge_id = r.json()["id"]
    r = client.put(f"{GE_API}/{ge_id}", json=_ge_body([{"name": "语文", "full": 120}]), headers=h)
    assert r.status_code == 200, r.text
    assert seen == sorted(seen) and len(seen) == 3
    seen.clear()
    # 同步:两个新班,名字序(丁 < 戊)与 id 序相反
    first = _class_with_id(db, "00000000-0000-0000-0000-000000000001", "三年戊班")
    _class_with_id(db, "00000000-0000-0000-0000-000000000002", "三年丁班")
    r = client.post(f"{GE_API}/{ge_id}/sync", headers=h)
    assert r.status_code == 200, r.text
    assert seen == sorted(seen) and seen[0] == first and len(seen) == 2


def test_grade_exam_subject_must_be_in_catalog(client, settings, db):
    h = auth(settings, DEAN)
    typo = _ge_body([{"name": "语文", "full": 100}, {"name": "数字", "full": 100}])
    r = client.post(GE_API, json=typo, headers=h)
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "SUBJECT_NOT_IN_CATALOG"
    assert r.json()["error"]["details"] == {"subject": "数字"}
    assert "数字" in r.json()["error"]["message"]
    assert db.scalars(select(GradeExam)).first() is None
    ok = _ge_body([{"name": "语文", "full": 100}, {"name": "数学", "full": 100}])
    r = client.post(GE_API, json=ok, headers=h)
    assert r.status_code == 201, r.text
    ge_id = r.json()["id"]
    # 编辑时也不能新增目录外的科目
    more = _ge_body([*ok["subjects"], {"name": "奥数", "full": 100}])
    r = client.put(f"{GE_API}/{ge_id}", json=more, headers=h)
    assert r.status_code == 400 and r.json()["error"]["code"] == "SUBJECT_NOT_IN_CATALOG"
    # 目录去掉"数学"后,已有联考里的"数学"可以保留;新建联考不能再用
    without_math = {
        **DEFAULT_CATALOG,
        "primary": [s for s in DEFAULT_CATALOG["primary"] if s["name"] != "数学"],
    }
    assert (
        client.put(SAVE_CATALOG, headers=auth(settings, IT_ADMIN), json=without_math).status_code
        == 200
    )
    r = client.put(f"{GE_API}/{ge_id}", json=_ge_body(ok["subjects"], "期中联考(改)"), headers=h)
    assert r.status_code == 200, r.text
    assert [s["name"] for s in r.json()["subjects"]] == ["语文", "数学"]
    r = client.post(GE_API, json=_ge_body(ok["subjects"], "期末联考"), headers=h)
    assert r.status_code == 400 and r.json()["error"]["details"] == {"subject": "数学"}
    # 按年级学段取目录:三年级标成"初中"后,"物理"在目录里
    db.get(Grade, UUID(GRADE_ID)).stage = "初中"
    db.flush()
    r = client.post(GE_API, json=_ge_body([{"name": "物理", "full": 100}], "物理联考"), headers=h)
    assert r.status_code == 201, r.text


def test_parent_can_read_grading(client, settings):
    h = auth(settings, PARENT)
    r = client.get(GRADING, headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"pass_ratio": 0.6, "good_ratio": 0.85}
    assert client.get(CATALOG, headers=h).status_code == 200
    r = client.put(SAVE_GRADING, headers=h, json={"pass_ratio": 0.7, "good_ratio": 0.9})
    assert r.status_code == 403


@pytest.mark.parametrize(
    ("names", "expected"),
    [
        # 中文数字按数值比,不按码位("三" U+4E09 < "二" U+4E8C 的码位序是错的)
        (["三年十班", "三年三班", "三年二班"], ["三年二班", "三年三班", "三年十班"]),
        (["十年级", "一年级", "二年级"], ["一年级", "二年级", "十年级"]),
        # 阿拉伯数字与中文数字同序
        (["四班", "3班", "一班", "2班"], ["一班", "2班", "3班", "四班"]),
        (["高三1班", "高一2班", "高二10班"], ["高一2班", "高二10班", "高三1班"]),
        (["初三(10)班", "初三(2)班", "初三(1)班"], ["初三(1)班", "初三(2)班", "初三(10)班"]),
        (["二十一班", "三班", "十二班"], ["三班", "十二班", "二十一班"]),
        # 没有数字的按原文(码位序)
        (["实验班", "国际部"], ["国际部", "实验班"]),
        (["实验班", "三年二班", "三年一班"], ["三年一班", "三年二班", "实验班"]),
        # 全角数字当数字;带圈 / 上标数字 int() 不认,当文字,但绝不能抛异常
        (["３班", "一班", "2班"], ["一班", "2班", "３班"]),
        (["三年②班", "三年①班", "三年一班"], ["三年一班", "三年①班", "三年②班"]),
    ],
)
def test_class_sort_key(names, expected):
    assert sorted(names, key=class_sort_key) == expected
    assert sorted(reversed(names), key=class_sort_key) == expected


@pytest.mark.parametrize("name", ["三年①班", "二年级²班", "⑩班", "¹²班", "三年３班", "Ⅲ班"])
def test_class_sort_key_never_raises(name):
    key = class_sort_key(name)
    assert key[-1] == (-1, name)
    assert sorted([name, "一班", "实验班"], key=class_sort_key)


def test_class_sort_key_is_total_and_stable():
    assert class_sort_key("3班")[:-1] == class_sort_key("三班")[:-1]  # 只差收尾的原文
    assert class_sort_key("三班") < class_sort_key("4班")
    assert class_sort_key("2班") < class_sort_key("三班")
    # 前缀相同、长度不同的名字也能比(不会拿数字段和文字段直接比较)
    assert class_sort_key("") < class_sort_key("一班")
    assert class_sort_key("高一") < class_sort_key("高一1班") < class_sort_key("高一2班")
    assert class_sort_key("一百零一班") < class_sort_key("一百零二班")
