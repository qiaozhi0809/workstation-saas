import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import session_scope
from tests.seed_ids import CLASS_ID, SCHOOL_ID, STUDENT_IDS, TEACHER_USER_ID, YEAR_ID

NEW_TABLES = {
    "school_settings",
    "growth_records",
    "comments",
    "ai_chats",
    "ai_messages",
    "ai_batch_items",
    "year_upgrades",
}


def _enrollment(db, student_id):
    return db.execute(
        text("SELECT id FROM enrollments WHERE student_id = :s"), {"s": student_id}
    ).scalar_one()


def _growth(db, **over):
    p = {
        "student_id": STUDENT_IDS[0],
        "enrollment_id": _enrollment(db, STUDENT_IDS[0]),
        "class_id": CLASS_ID,
        "year_id": YEAR_ID,
        "type": "表扬",
        "content": "好",
    }
    p.update(over)
    db.execute(
        text(
            "INSERT INTO growth_records (student_id, enrollment_id, class_id, academic_year_id,"
            " type, date, content) VALUES (:student_id, :enrollment_id, :class_id, :year_id,"
            " :type, '2026-11-01', :content)"
        ),
        p,
    )


def _new_student(db, mk):
    return db.execute(
        text("INSERT INTO students (school_id, mk, name) VALUES (:s, :mk, :mk) RETURNING mask_no"),
        {"s": SCHOOL_ID, "mk": mk},
    ).scalar_one()


def test_new_tables_exist(db):
    tables = set(
        db.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        ).scalars()
    )
    assert NEW_TABLES <= tables


def test_mask_no_backfilled_in_mk_order(db):
    rows = db.execute(text("SELECT mk, mask_no FROM students ORDER BY mk")).all()
    assert [r.mask_no for r in rows] == list(range(1, 23))


def test_new_student_gets_next_mask_no(db):
    # 序列不随测试回滚,只能断言"大于种子且逐一递增"
    first = _new_student(db, "S9001")
    second = _new_student(db, "S9002")
    assert first >= 23
    assert second == first + 1


def test_mask_no_unique_per_school(db):
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE students SET mask_no = 1 WHERE mk = 'S0002'"))


def test_enrollment_promoted_status_allowed(db):
    db.execute(
        text("UPDATE enrollments SET status = 'promoted' WHERE student_id = :s"),
        {"s": STUDENT_IDS[0]},
    )
    with pytest.raises(IntegrityError):
        db.execute(
            text("UPDATE enrollments SET status = 'gone' WHERE student_id = :s"),
            {"s": STUDENT_IDS[1]},
        )


@pytest.mark.parametrize(
    "over",
    [{"type": "批评"}, {"content": ""}, {"content": "字" * 501}],
)
def test_growth_type_and_length_checked(db, over):
    with pytest.raises(IntegrityError):
        _growth(db, **over)


def test_growth_boundary_content_ok(db):
    _growth(db, content="字" * 500)


def test_school_setting_unique_key(db):
    ins = text("INSERT INTO school_settings (school_id, key, value) VALUES (:s, 'ai', '{}')")
    db.execute(ins, {"s": SCHOOL_ID})
    with pytest.raises(IntegrityError):
        db.execute(ins, {"s": SCHOOL_ID})


def test_seed_growth_and_comment(db):
    growth = db.execute(
        text(
            "SELECT s.name, count(*) AS n FROM growth_records g"
            " JOIN students s ON s.id = g.student_id GROUP BY s.name ORDER BY s.name"
        )
    ).all()
    assert {(r.name, r.n) for r in growth} == {("王小一", 2), ("陈小五", 1)}
    comments = db.execute(
        text("SELECT s.name, c.semester FROM comments c JOIN students s ON s.id = c.student_id")
    ).all()
    assert [(r.name, r.semester) for r in comments] == [("李小二", "2026-2027 第一学期")]


def test_session_scope_reuses_test_session(client, db):
    db.execute(
        text("INSERT INTO school_settings (school_id, key, value) VALUES (:s, 'probe', '{}')"),
        {"s": SCHOOL_ID},
    )
    scope = client.app.dependency_overrides[session_scope]()
    with scope() as s:
        assert s is db
        n = s.execute(text("SELECT count(*) FROM school_settings WHERE key = 'probe'")).scalar_one()
    assert n == 1
    # 退出上下文不得关闭测试会话
    assert db.execute(text("SELECT 1")).scalar_one() == 1


def test_message_timestamps_strictly_increase_within_one_transaction(db):
    chat_id = db.execute(
        text(
            "INSERT INTO ai_chats (user_id, class_id, title, mask)"
            " VALUES (:u, :c, 't', true) RETURNING id"
        ),
        {"u": TEACHER_USER_ID, "c": CLASS_ID},
    ).scalar_one()
    for role in ("user", "assistant"):
        db.execute(
            text("INSERT INTO ai_messages (chat_id, role) VALUES (:c, :r)"),
            {"c": chat_id, "r": role},
        )
    rows = db.execute(
        text("SELECT role, created_at FROM ai_messages WHERE chat_id = :c ORDER BY created_at"),
        {"c": chat_id},
    ).all()
    assert [r[0] for r in rows] == ["user", "assistant"]
    assert rows[0][1] < rows[1][1]
