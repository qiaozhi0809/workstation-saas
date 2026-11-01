import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.seed_ids import ASSISTANT_USER_ID, CLASS_ID, STUDENT_IDS, SUBJECT_USER_ID

NEW_TABLES = {
    "attendances",
    "attendance_days",
    "reviews",
    "seat_arrangements",
    "class_boards",
    "todos",
    "user_preferences",
}


def _enrollment(db, student_id):
    return db.execute(
        text("SELECT id FROM enrollments WHERE student_id = :s"), {"s": student_id}
    ).scalar_one()


def test_new_tables_exist(db):
    rows = db.execute(
        text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
    ).scalars()
    assert NEW_TABLES <= set(rows)


def test_attendance_unique_per_student_per_day(db):
    sql = text(
        "INSERT INTO attendances (enrollment_id, class_id, date, status) "
        "VALUES (:e, :c, '2026-11-02', :s)"
    )
    e = _enrollment(db, STUDENT_IDS[0])
    db.execute(sql, {"e": e, "c": CLASS_ID, "s": "leave"})
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(sql, {"e": e, "c": CLASS_ID, "s": "late"})


def test_attendance_does_not_store_present(db):
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            text(
                "INSERT INTO attendances (enrollment_id, class_id, date, status) "
                "VALUES (:e, :c, '2026-11-02', 'present')"
            ),
            {"e": _enrollment(db, STUDENT_IDS[0]), "c": CLASS_ID},
        )


def test_one_active_student_per_seat(db):
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            text("UPDATE enrollments SET seat_row = 1, seat_col = 1 WHERE student_id = :s"),
            {"s": STUDENT_IDS[1]},
        )


def test_locked_student_must_have_a_seat(db):
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            text(
                "UPDATE enrollments SET seat_row = NULL, seat_col = NULL, seat_locked = true "
                "WHERE student_id = :s"
            ),
            {"s": STUDENT_IDS[0]},
        )


def test_review_delta_must_be_nonzero(db):
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(
            text(
                "INSERT INTO reviews (op_id, enrollment_id, class_id, category, reason_text, "
                "score_delta) VALUES (gen_random_uuid(), :e, :c, 'individual', '测试', 0)"
            ),
            {"e": _enrollment(db, STUDENT_IDS[0]), "c": CLASS_ID},
        )


def test_seed_has_m2a_data(db):
    role = db.execute(
        text(
            "SELECT e.class_role FROM enrollments e JOIN students s ON s.id = e.student_id "
            "WHERE s.id = :s"
        ),
        {"s": STUDENT_IDS[0]},
    ).scalar_one()
    assert role == "班长"
    leap = db.execute(
        text("SELECT birthdate::text FROM students WHERE id = :s"), {"s": STUDENT_IDS[2]}
    ).scalar_one()
    assert leap == "2016-02-29"
    bindings = dict(
        db.execute(
            text("SELECT user_id::text, role_type FROM role_bindings WHERE user_id IN (:a, :b)"),
            {"a": ASSISTANT_USER_ID, "b": SUBJECT_USER_ID},
        ).all()
    )
    assert bindings == {
        ASSISTANT_USER_ID: "assistant_teacher",
        SUBJECT_USER_ID: "subject_teacher",
    }
