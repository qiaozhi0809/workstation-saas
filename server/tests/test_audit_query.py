import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import func, select

import app as app_pkg
from app.audit.labels import ACTION_LABELS, GROUPS
from app.models import Exam, School, SchoolClass, Student, User
from app.models.audit import AuditLog
from app.rbac.roles import Perm
from tests.helpers import auth
from tests.seed_ids import CLASS_ID, EXAM_IDS, SCHOOL_ID, STUDENT_IDS

AUDIT = "/api/v1/admin/audit"
ACTIONS = "/api/v1/admin/audit/actions"
PRINCIPAL = "55555555-5555-5555-5555-555555555543"
DEAN = "55555555-5555-5555-5555-555555555544"
IT_ADMIN = "55555555-5555-5555-5555-555555555546"
TEACHER = "55555555-5555-5555-5555-555555555555"
GROUP_KEYS = [
    "student",
    "grade",
    "review",
    "record",
    "ai",
    "account",
    "org",
    "settings",
    "year",
    "notice",
    "denied",
]


def _utc(iso: str) -> datetime:
    return datetime.fromisoformat(iso).replace(tzinfo=UTC)


def _add(db, at: str, action: str = "student.update", **kw) -> AuditLog:
    row = AuditLog(
        at=_utc(at),
        action=action,
        success=kw.pop("success", True),
        user_id=kw.pop("user_id", UUID(PRINCIPAL)),
        **kw,
    )
    db.add(row)
    db.flush()
    return row


def _get(client, settings, params=None, user=PRINCIPAL, url=AUDIT):
    return client.get(url, headers=auth(settings, user), params=params or {})


def _items(res):
    assert res.status_code == 200, res.text
    return res.json()["items"]


def test_permissions(client, settings):
    assert _get(client, settings, user=DEAN).status_code == 403
    assert _get(client, settings, user=DEAN, url=ACTIONS).status_code == 403
    assert _get(client, settings, user=TEACHER).status_code == 403
    assert _get(client, settings, user=PRINCIPAL).status_code == 200
    assert _get(client, settings, user=IT_ADMIN).status_code == 200
    assert _get(client, settings, user=IT_ADMIN, url=ACTIONS).status_code == 200


def test_actions_groups_fixed(client, settings):
    body = _get(client, settings, url=ACTIONS).json()
    assert [g["key"] for g in body["groups"]] == GROUP_KEYS
    assert [g["label"] for g in body["groups"]][:2] == ["学生档案", "成绩与考试"]
    by_key = {g["key"]: g for g in body["groups"]}
    assert by_key["denied"]["label"] == "被拒的访问"
    assert by_key["denied"]["actions"] == []
    assert {"action": "student.update", "label": ACTION_LABELS["student.update"]} in by_key[
        "student"
    ]["actions"]
    assert {"action": "ai.generate", "label": ACTION_LABELS["ai.generate"]} in by_key["ai"][
        "actions"
    ]
    assert any(a["action"] == "notice.send" for a in by_key["notice"]["actions"])
    assert any(a["action"] == "exam.grade_create" for a in by_key["grade"]["actions"])


def test_time_range_uses_school_local_dates_inclusive(client, settings, db):
    # 学校时区 Asia/Shanghai(UTC+8):11-01 本地 00:00 = 10-31 16:00Z
    _add(db, "2026-10-31T15:59:59", object_id="t-before")
    _add(db, "2026-10-31T16:00:00", object_id="t-first")
    _add(db, "2026-11-02T15:59:59", object_id="t-last")
    _add(db, "2026-11-02T16:00:00", object_id="t-after")
    ids = [
        r["object_id"]
        for r in _items(_get(client, settings, {"from": "2026-11-01", "to": "2026-11-02"}))
    ]
    assert ids == ["t-last", "t-first"]  # 时间倒序
    only_from = [r["object_id"] for r in _items(_get(client, settings, {"from": "2026-11-02"}))]
    assert "t-after" in only_from and "t-last" in only_from and "t-first" not in only_from
    only_to = [r["object_id"] for r in _items(_get(client, settings, {"to": "2026-10-31"}))]
    assert "t-first" not in only_to and "t-before" in only_to


def test_filters(client, settings, db):
    day = {"from": "2026-11-01", "to": "2026-11-01"}
    _add(db, "2026-11-01T02:00:00", "student.update", object_type="student", object_id="f1")
    _add(db, "2026-11-01T03:00:00", "score.write", object_type="exam", object_id="f2")
    _add(
        db,
        "2026-11-01T04:00:00",
        "account.create",
        object_type="user",
        object_id="f3",
        user_id=UUID(IT_ADMIN),
    )
    _add(
        db,
        "2026-11-01T05:00:00",
        "student.list",
        success=False,
        object_type="class",
        object_id="f4",
        user_id=UUID(TEACHER),
    )
    _add(db, "2026-11-01T06:00:00", "notice.send", object_type="notice", object_id="f5")

    def ids(**extra):
        return [r["object_id"] for r in _items(_get(client, settings, {**day, **extra}))]

    assert ids() == ["f5", "f4", "f3", "f2", "f1"]
    assert ids(user_id=IT_ADMIN) == ["f3"]
    assert ids(group="student") == ["f4", "f1"]
    assert ids(group="grade") == ["f2"]
    assert ids(group="account") == ["f3"]
    assert ids(group="notice") == ["f5"]
    assert ids(group="denied") == ["f4"]
    assert ids(action="score.write") == ["f2"]
    assert ids(group="grade", action="score.write") == ["f2"]
    assert ids(group="student", action="score.write") == []
    assert ids(object_type="class") == ["f4"]
    assert ids(object_type="student", object_id="f1") == ["f1"]
    assert ids(success="false") == ["f4"]
    assert ids(success="true") == ["f5", "f3", "f2", "f1"]
    assert _get(client, settings, {"group": "nope"}).status_code == 400


def test_row_shape(client, settings, db):
    _add(
        db,
        "2026-11-01T02:00:00",
        "student.update",
        object_type="student",
        object_id="shape",
        ip="203.0.113.9",
        extra={"fields": ["name"]},
    )
    _add(db, "2026-11-01T01:00:00", "future.unknown_action", object_id="shape2")
    rows = _items(_get(client, settings, {"from": "2026-11-01", "to": "2026-11-01"}))
    row = rows[0]
    assert set(row) == {
        "id",
        "at",
        "user_id",
        "user_name",
        "action",
        "action_label",
        "object_type",
        "object_id",
        "object_label",
        "ip",
        "success",
        "extra",
    }
    assert row["user_id"] == PRINCIPAL
    assert row["user_name"] == db.get(User, UUID(PRINCIPAL)).display_name
    assert row["action_label"] == ACTION_LABELS["student.update"]
    assert row["ip"] == "203.0.113.9" and row["success"] is True
    assert row["extra"] == {"fields": ["name"]}
    assert datetime.fromisoformat(row["at"]) == _utc("2026-11-01T02:00:00")
    assert rows[1]["action_label"] == "future.unknown_action"  # 没收录的回原值
    assert rows[1]["user_id"] == PRINCIPAL


def test_system_row_without_user(client, settings, db):
    _add(db, "2026-11-01T02:00:00", "ai.config", user_id=None, object_id="sys")
    row = _items(_get(client, settings, {"from": "2026-11-01", "to": "2026-11-01"}))[0]
    assert row["user_id"] is None and row["user_name"] is None


def test_object_label(client, settings, db):
    student = db.get(Student, UUID(STUDENT_IDS[0]))
    klass = db.get(SchoolClass, UUID(CLASS_ID))
    user = db.get(User, UUID(TEACHER))
    exam = db.get(Exam, UUID(EXAM_IDS[0]))
    _add(db, "2026-11-01T01:00:00", object_type="student", object_id=STUDENT_IDS[0])
    _add(db, "2026-11-01T02:00:00", object_type="class", object_id=CLASS_ID)
    _add(db, "2026-11-01T03:00:00", object_type="user", object_id=TEACHER)
    _add(db, "2026-11-01T04:00:00", object_type="exam", object_id=EXAM_IDS[0])
    _add(db, "2026-11-01T05:00:00", object_type="student", object_id="not-a-uuid")
    _add(db, "2026-11-01T06:00:00", object_type="student", object_id=str(UUID(int=7)))
    _add(db, "2026-11-01T07:00:00", object_type="school", object_id=SCHOOL_ID)
    _add(db, "2026-11-01T08:00:00", object_type=None, object_id=None)
    rows = _items(_get(client, settings, {"from": "2026-11-01", "to": "2026-11-01"}))
    labels = [r["object_label"] for r in reversed(rows)]
    assert labels == [
        student.name,
        klass.name,
        user.display_name,
        exam.name,
        None,
        None,
        db.get(School, UUID(SCHOOL_ID)).name,  # school 也能解析名称
        None,
    ]


def test_paging_total(client, settings, db):
    base = _utc("2026-11-01T00:00:00")
    for i in range(55):
        db.add(
            AuditLog(
                at=base + timedelta(minutes=i),
                action="student.update",
                success=True,
                user_id=UUID(PRINCIPAL),
                object_id=f"p{i:02d}",
            )
        )
    db.flush()
    day = {"from": "2026-11-01", "to": "2026-11-01"}
    p1 = _get(client, settings, day).json()
    p2 = _get(client, settings, {**day, "page": 2}).json()
    p3 = _get(client, settings, {**day, "page": 3}).json()
    assert p1["total"] == p2["total"] == p3["total"] == 55
    assert len(p1["items"]) == 50 and len(p2["items"]) == 5 and p3["items"] == []
    assert p1["items"][0]["object_id"] == "p54" and p2["items"][-1]["object_id"] == "p00"
    assert _get(client, settings, {"page": 0}).status_code == 400


def test_query_writes_no_audit(client, settings, db):
    before = db.scalar(select(func.count()).select_from(AuditLog))
    _get(client, settings)
    _get(client, settings, url=ACTIONS)
    assert db.scalar(select(func.count()).select_from(AuditLog)) == before


def test_denied_access_is_queryable(client, settings):
    assert _get(client, settings, user=DEAN).status_code == 403
    rows = _items(_get(client, settings, {"group": "denied", "user_id": DEAN}))
    assert rows[0]["action"] == "audit.read" and rows[0]["success"] is False
    assert rows[0]["action_label"] == ACTION_LABELS["audit.read"]
    assert rows[0]["object_type"] == "school"


# 不是审计动作的 action="..." 字面量:argparse 的 store_true/store_false,
# 以及升学建议(years/suggest.py、years/service.py)里班级方案的 new/promote/graduate
NON_AUDIT_ACTION_LITERALS = {"store_true", "store_false", "new", "promote", "graduate"}
# 以常量传入 action= 的审计动作(overview/reports 的被拒访问,action=SCHOOL_VIEW)
CONSTANT_ACTIONS = {"school.view"}
# M3b 计划新增的审计动作(契约"审计动作"一节);其中部分在后续任务才出现在代码里
M3B_NEW_ACTIONS = {
    "exam.grade_create",
    "exam.grade_update",
    "exam.grade_delete",
    "exam.grade_sync",
    "attendance.export",
    "notice.send",
    "notice.recall",
}
# M3a 新增动作
M3A_NEW_ACTIONS = {
    "account.create",
    "account.update",
    "account.reset_password",
    "account.freeze",
    "account.unfreeze",
    "account.import",
    "org.school",
    "org.year",
    "org.grade_create",
    "org.grade_update",
    "org.grade_delete",
    "org.class_create",
    "org.class_update",
    "org.class_delete",
    "org.staff_add",
    "org.staff_end",
    "org.role_add",
    "org.role_end",
    "settings.tag_pool",
    "settings.switches",
    "year.upgrade",
    "year.rollback",
    "ai.config",
    "ai.generate",
    "ai.prompt_copy",
}


def _actions_in_code() -> set[str]:
    root = Path(app_pkg.__file__).parent
    found: set[str] = set()
    for path in root.rglob("*.py"):
        found |= set(re.findall(r'action="([a-z_.]+)"', path.read_text(encoding="utf-8")))
    return found - NON_AUDIT_ACTION_LITERALS


def test_every_action_has_label():
    code_actions = _actions_in_code()
    assert "student.update" in code_actions and "ai.generate" in code_actions  # 扫描确实生效
    required = code_actions | CONSTANT_ACTIONS | M3A_NEW_ACTIONS | M3B_NEW_ACTIONS
    required |= {perm.value for perm in Perm}  # 被拒访问的动作名就是权限点
    missing = sorted(a for a in required if a not in ACTION_LABELS)
    assert missing == []
    for action, label in ACTION_LABELS.items():
        assert re.search(r"[一-鿿]", label), action


def test_groups_cover_known_actions():
    assert [key for key, _, _ in GROUPS] == GROUP_KEYS
    for key, _label, pred in GROUPS:
        if key == "denied":
            assert pred("student.update", False) and not pred("student.update", True)
    # 业务动作各自落在恰好一个业务组(denied 之外)
    business = [(k, p) for k, _, p in GROUPS if k != "denied"]
    for action in M3A_NEW_ACTIONS | M3B_NEW_ACTIONS | _actions_in_code() - CONSTANT_ACTIONS:
        hit = [k for k, p in business if p(action, True)]
        assert len(hit) == 1, (action, hit)


@pytest.mark.parametrize(
    ("action", "group"),
    [
        ("student.write_notes", "student"),
        ("score.export", "grade"),
        ("exam.grade_sync", "grade"),
        ("review.revoke", "review"),
        ("class.layout", "review"),
        ("comment.create", "record"),
        ("growth.delete", "record"),
        ("ai.config", "ai"),
        ("account.import", "account"),
        ("org.role_end", "org"),
        ("settings.switches", "settings"),
        ("year.rollback", "year"),
        ("notice.recall", "notice"),
    ],
)
def test_group_of(action, group):
    assert [k for k, _, p in GROUPS if k != "denied" and p(action, True)] == [group]


def test_object_label_school_and_grade_exam(client, settings, db):
    from datetime import date

    from app.models import GradeExam
    from tests.seed_ids import GRADE_ID, YEAR_ID

    ge = GradeExam(
        school_id=UUID(SCHOOL_ID),
        academic_year_id=UUID(YEAR_ID),
        grade_id=UUID(GRADE_ID),
        name="三年级期中联考",
        exam_type="期中",
        date=date(2026, 11, 1),
        subjects=[],
    )
    db.add(ge)
    db.flush()
    _add(db, "2026-11-01T01:00:00", "attendance.export", object_type="school", object_id=SCHOOL_ID)
    _add(
        db,
        "2026-11-01T02:00:00",
        "exam.grade_update",
        object_type="grade_exam",
        object_id=str(ge.id),
    )
    rows = _items(_get(client, settings, {"from": "2026-11-01", "to": "2026-11-01"}))
    assert [r["object_label"] for r in reversed(rows)] == [
        db.get(School, UUID(SCHOOL_ID)).name,
        "三年级期中联考",
    ]


def test_date_out_of_range_is_400(client, settings):
    for params in (
        {"to": "9999-12-31"},
        {"from": "0001-01-01"},
        {"from": "1969-12-31"},
        {"to": "2101-01-01"},
    ):
        assert _get(client, settings, params).status_code == 400, params
    ok = {"from": "1970-01-01", "to": "2100-12-31"}
    assert _get(client, settings, ok).status_code == 200
