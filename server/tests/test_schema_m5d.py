"""迁移 0013:通知班级快照、首次引导状态、令牌下限(新列、默认值、回填、往返)。"""

import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url

from app.models import NoticeStudent, User, UserPreference
from tests.factories import make_class, make_student, make_user
from tests.seed_ids import SCHOOL_ID

SERVER_DIR = Path(__file__).resolve().parent.parent
NEW_COLUMNS = {
    ("notice_students", "class_id"),
    ("notice_students", "class_name"),
    ("user_preferences", "onboarded"),
    ("users", "token_floor_at"),
}


def _columns(conn, table):
    return {
        r[0]: r
        for r in conn.execute(
            text(
                "SELECT column_name, is_nullable, column_default"
                " FROM information_schema.columns WHERE table_name = :t"
            ),
            {"t": table},
        )
    }


def test_new_columns_nullable_and_defaults(db):
    ns = _columns(db, "notice_students")
    assert ns["class_id"][1] == "YES" and ns["class_id"][2] is None
    assert ns["class_name"][1] == "YES" and ns["class_name"][2] is None
    prefs = _columns(db, "user_preferences")
    assert prefs["onboarded"][1] == "NO" and "'{}'::jsonb" in prefs["onboarded"][2]
    users = _columns(db, "users")
    assert users["token_floor_at"][1] == "YES" and users["token_floor_at"][2] is None


def _notice(db) -> uuid.UUID:
    return db.execute(
        text(
            "INSERT INTO notices (school_id, title, content, target, target_label, audience)"
            " VALUES (:s, '通知', '内容', '{}', '家长', 'parents') RETURNING id"
        ),
        {"s": SCHOOL_ID},
    ).scalar_one()


def test_notice_student_class_fk_sets_null_but_keeps_name(db):
    cid = make_class(db, "快照班")
    sid = make_student(db, cid, "某学生", "m5d-snap-1")
    parent = make_user(db, "m5d_parent_" + uuid.uuid4().hex[:6], "某家长")
    nid = _notice(db)
    db.add(
        NoticeStudent(
            notice_id=nid,
            student_id=sid,
            parent_user_id=parent.id,
            class_id=cid,
            class_name="快照班",
        )
    )
    db.flush()
    db.execute(text("DELETE FROM classes WHERE id = :c"), {"c": cid})
    db.expire_all()
    row = db.execute(
        text("SELECT class_id, class_name FROM notice_students WHERE notice_id = :n"), {"n": nid}
    ).one()
    assert tuple(row) == (None, "快照班")


def test_orm_defaults(db):
    user = make_user(db, "m5d_" + uuid.uuid4().hex[:6], "新用户")
    db.add(UserPreference(user_id=user.id))
    db.flush()
    db.expire_all()
    pref = db.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    assert pref.onboarded == {}
    assert db.get(User, user.id).token_floor_at is None


def test_seed_accounts_are_onboarded_in_every_context(db):
    """种子账号都是在用的老账号:三种语境的首次引导一律已看过,E2E 第一次登录不会被欢迎页挡住。"""
    missing = (
        db.execute(
            text(
                "SELECT u.login_name FROM users u "
                "LEFT JOIN user_preferences p ON p.user_id = u.id "
                "WHERE u.school_id = :sid "
                "AND NOT (COALESCE(p.onboarded, '{}'::jsonb) ?& array['teacher','parent','admin'])"
            ),
            {"sid": str(SCHOOL_ID)},
        )
        .scalars()
        .all()
    )
    assert missing == []


@pytest.fixture
def scratch_cfg(pg_url):
    admin = create_engine(pg_url, isolation_level="AUTOCOMMIT")
    name = "m5d_mig_" + uuid.uuid4().hex[:8]
    with admin.connect() as conn:
        conn.execute(text(f"CREATE DATABASE {name}"))
    url = make_url(pg_url).set(database=name).render_as_string(hide_password=False)
    cfg = Config(str(SERVER_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(SERVER_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    eng = create_engine(url)
    yield cfg, eng
    eng.dispose()
    with admin.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
    admin.dispose()


def _present(eng) -> set[tuple[str, str]]:
    with eng.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns"
                " WHERE (table_name, column_name) IN"
                " (('notice_students','class_id'),('notice_students','class_name'),"
                " ('user_preferences','onboarded'),('users','token_floor_at'))"
            )
        ).all()
    return {(t, c) for t, c in rows}


class _OldDb:
    """0012 结构上的最小数据:学校、学年、年级、两个班、家长账号与一条家长通知。"""

    def __init__(self, conn):
        self.conn = conn
        self.school = conn.execute(
            text("INSERT INTO schools (name) VALUES ('测试学校') RETURNING id")
        ).scalar()
        self.year = conn.execute(
            text(
                "INSERT INTO academic_years (school_id, name, start_date, end_date, is_active)"
                " VALUES (:s, '2026-2027', '2026-09-01', '2027-07-01', true) RETURNING id"
            ),
            {"s": self.school},
        ).scalar()
        self.grade = conn.execute(
            text(
                "INSERT INTO grades (school_id, academic_year_id, name)"
                " VALUES (:s, :y, '三年级') RETURNING id"
            ),
            {"s": self.school, "y": self.year},
        ).scalar()
        self.parent = conn.execute(
            text(
                "INSERT INTO users (school_id, login_name, password_hash, display_name)"
                " VALUES (:s, 'p01', 'x', '某家长') RETURNING id"
            ),
            {"s": self.school},
        ).scalar()
        self.notice = conn.execute(
            text(
                "INSERT INTO notices (school_id, title, content, target, target_label, audience)"
                " VALUES (:s, '通知', '内容', '{}', '家长', 'parents') RETURNING id"
            ),
            {"s": self.school},
        ).scalar()
        self._n = 0
        # 每个班记下所属学年:注册行要带 academic_year_id(同学年一人只能有一条 active)
        self._class_year: dict[object, object] = {}

    def another_year(self, name: str, start: str, end: str):
        """再建一个(非当前)学年及其一个年级,返回 (year_id, grade_id)。"""
        year = self.conn.execute(
            text(
                "INSERT INTO academic_years (school_id, name, start_date, end_date, is_active)"
                " VALUES (:s, :n, :a, :b, false) RETURNING id"
            ),
            {"s": self.school, "n": name, "a": start, "b": end},
        ).scalar()
        grade = self.conn.execute(
            text(
                "INSERT INTO grades (school_id, academic_year_id, name)"
                " VALUES (:s, :y, '三年级') RETURNING id"
            ),
            {"s": self.school, "y": year},
        ).scalar()
        return year, grade

    def klass(self, name: str, year_grade: tuple[object, object] | None = None):
        year, grade = year_grade or (self.year, self.grade)
        cid = self.conn.execute(
            text(
                "INSERT INTO classes (school_id, academic_year_id, grade_id, name)"
                " VALUES (:s, :y, :g, :n) RETURNING id"
            ),
            {"s": self.school, "y": year, "g": grade, "n": name},
        ).scalar()
        self._class_year[cid] = year
        return cid

    def student(self, *enrollments: tuple[object, str, str]):
        """enrollments: (class_id, status, entered_at);同时写进通知的 notice_students。"""
        self._n += 1
        sid = self.conn.execute(
            text(
                "INSERT INTO students (school_id, mk, name) VALUES (:s, :mk, '某学生') RETURNING id"
            ),
            {"s": self.school, "mk": f"mk{self._n}"},
        ).scalar()
        for class_id, status, entered_at in enrollments:
            self.conn.execute(
                text(
                    "INSERT INTO enrollments (student_id, class_id, academic_year_id, status,"
                    " entered_at) VALUES (:sid, :c, :y, :st, :at)"
                ),
                {
                    "sid": sid,
                    "c": class_id,
                    "y": self._class_year[class_id],
                    "st": status,
                    "at": entered_at,
                },
            )
        self.conn.execute(
            text(
                "INSERT INTO notice_students (notice_id, student_id, parent_user_id)"
                " VALUES (:n, :sid, :p)"
            ),
            {"n": self.notice, "sid": sid, "p": self.parent},
        )
        return sid


def test_backfill_class_snapshot(scratch_cfg):
    """迁移前的家长通知:回填取迁移时刻的在读班;已毕业(没有在读注册)取最后一个班;
    从未注册的留 NULL;只用仍存在的班;跨学年两条都在读(升学没收尾的脏数据)取最近一条。"""
    cfg, eng = scratch_cfg
    command.upgrade(cfg, "0012")
    with eng.begin() as conn:
        old = _OldDb(conn)
        a, b = old.klass("三年一班"), old.klass("三年二班")
        gone = old.klass("已删班")
        last_year = old.klass(
            "去年二年一班", old.another_year("2025-2026", "2025-09-01", "2026-07-01")
        )
        # 同一学生在两个学年各有一条 active(同学年唯一索引拦不住跨学年):按 entered_at 取最新
        two_active = old.student((last_year, "active", "2025-09-01"), (a, "active", "2026-09-01"))
        # 顺序反过来写入也一样,不靠插入顺序
        two_active_rev = old.student(
            (b, "active", "2026-09-01"), (last_year, "active", "2025-09-01")
        )
        in_a = old.student((a, "active", "2026-09-01"))
        graduated = old.student((a, "graduated", "2026-09-01"))
        promoted = old.student((a, "promoted", "2025-09-01"), (b, "active", "2026-09-01"))
        # 在读注册比一条已移出的注册更早:在读优先
        active_older = old.student((a, "active", "2025-09-01"), (b, "removed", "2026-09-01"))
        # 两条都不在读:取最近一条
        two_old = old.student((a, "promoted", "2024-09-01"), (b, "graduated", "2025-09-01"))
        never = old.student()
        was_in_gone = old.student((gone, "transferred", "2026-09-01"))
        conn.execute(text("DELETE FROM classes WHERE id = :c"), {"c": gone})
    command.upgrade(cfg, "0013")
    with eng.connect() as conn:
        got = {
            r.student_id: (r.class_id, r.class_name)
            for r in conn.execute(
                text("SELECT student_id, class_id, class_name FROM notice_students")
            )
        }
    assert got[in_a] == (a, "三年一班")
    assert got[graduated] == (a, "三年一班")
    assert got[promoted] == (b, "三年二班")
    assert got[active_older] == (a, "三年一班")
    assert got[two_old] == (b, "三年二班")
    assert got[never] == (None, None)
    assert got[was_in_gone] == (None, None)
    assert got[two_active] == (a, "三年一班")
    assert got[two_active_rev] == (b, "三年二班")
    with eng.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0013"
        onboarded = conn.execute(text("SELECT onboarded FROM user_preferences")).all()
        assert onboarded == []  # 没有旧行也不报错;列默认见 test_new_columns_nullable_and_defaults
        assert (
            conn.execute(text("SELECT token_floor_at FROM users WHERE login_name = 'p01'")).scalar()
            is None
        )


def test_roundtrip_upgrade_downgrade_upgrade(scratch_cfg):
    cfg, eng = scratch_cfg
    command.upgrade(cfg, "head")
    assert _present(eng) == NEW_COLUMNS
    command.downgrade(cfg, "0012")
    assert _present(eng) == set()
    with eng.connect() as conn:
        assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0012"
    command.upgrade(cfg, "head")
    assert _present(eng) == NEW_COLUMNS
