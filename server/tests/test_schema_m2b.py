import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.seed_ids import CLASS_ID, EXAM_IDS, STUDENT_IDS


def _enrollment(db, student_id):
    return db.execute(
        text("SELECT id FROM enrollments WHERE student_id = :s"), {"s": student_id}
    ).scalar_one()


def _columns(db, table):
    return set(
        db.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :t"
            ),
            {"t": table},
        ).scalars()
    )


def test_new_tables_and_columns(db):
    tables = set(
        db.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        ).scalars()
    )
    assert {"exams", "scores"} <= tables
    assert "subjects" in _columns(db, "classes")
    assert {"boarding", "family_note", "note", "contacts"} <= _columns(db, "students")


def test_score_unique_per_cell(db):
    enr = _enrollment(db, STUDENT_IDS[0])
    sql = text(
        "INSERT INTO scores (exam_id, enrollment_id, subject, value) VALUES (:e, :n, '物理', 50)"
    )
    db.execute(sql, {"e": EXAM_IDS[0], "n": enr})
    with pytest.raises(IntegrityError):
        db.execute(sql, {"e": EXAM_IDS[0], "n": enr})


def test_score_value_not_negative(db):
    enr = _enrollment(db, STUDENT_IDS[0])
    with pytest.raises(IntegrityError):
        db.execute(
            text(
                "INSERT INTO scores (exam_id, enrollment_id, subject, value) "
                "VALUES (:e, :n, '物理', -1)"
            ),
            {"e": EXAM_IDS[0], "n": enr},
        )


def test_enrollment_removed_status_allowed(db):
    enr = _enrollment(db, STUDENT_IDS[0])
    db.execute(text("UPDATE enrollments SET status = 'removed' WHERE id = :i"), {"i": enr})
    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE enrollments SET status = 'gone' WHERE id = :i"), {"i": enr})


def test_seed_exams_and_absent(db):
    for exam_id in EXAM_IDS:
        n = db.execute(
            text("SELECT count(*) FROM scores WHERE exam_id = :e"), {"e": exam_id}
        ).scalar_one()
        assert n == 30
    value, present = db.execute(
        text(
            "SELECT s.value, true FROM scores s JOIN enrollments e ON e.id = s.enrollment_id "
            "WHERE s.exam_id = :x AND e.student_id = :st AND s.subject = '英语'"
        ),
        {"x": EXAM_IDS[1], "st": STUDENT_IDS[4]},
    ).one()
    assert present and value is None
    assert (
        db.execute(
            text("SELECT subjects IS NULL FROM classes WHERE id = :c"), {"c": CLASS_ID}
        ).scalar_one()
        is True
    )
