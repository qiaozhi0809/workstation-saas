from sqlalchemy import text

EXPECTED_TABLES = {
    "schools",
    "academic_years",
    "grades",
    "classes",
    "users",
    "teachers",
    "students",
    "enrollments",
    "teacher_assignments",
    "parents",
    "parent_links",
    "role_bindings",
    "audit_logs",
}


def test_all_tables_exist(db):
    rows = db.execute(
        text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' AND table_type='BASE TABLE'"
        )
    ).scalars()
    assert EXPECTED_TABLES <= set(rows)


def test_seed_counts(db):
    assert db.execute(text("SELECT count(*) FROM students")).scalar_one() == 22
    assert db.execute(text("SELECT count(*) FROM enrollments")).scalar_one() == 22


def test_seed_seats_follow_mk_order(db):
    seats = dict(
        db.execute(
            text(
                "SELECT s.mk, (e.seat_row, e.seat_col)::text FROM enrollments e "
                "JOIN students s ON s.id = e.student_id"
            )
        ).all()
    )
    assert seats["S0001"] == "(1,1)"
    assert seats["S0004"] == "(1,4)"
    assert seats["S0010"] == "(3,2)"


def test_updated_at_trigger(db):
    before = db.execute(text("SELECT updated_at FROM schools")).scalar_one()
    db.execute(text("UPDATE schools SET name = '示例小学2'"))
    after = db.execute(text("SELECT updated_at FROM schools")).scalar_one()
    assert after > before  # 测试事务的 now() 晚于 seed 提交时间
