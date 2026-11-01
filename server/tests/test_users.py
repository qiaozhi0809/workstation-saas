from uuid import UUID

from app.auth.passwords import verify_password
from app.auth.service import get_user, get_user_by_login
from tests.seed_ids import SCHOOL_ID, TEACHER_USER_ID


def test_seed_teacher_password_is_verifiable(db):
    u = get_user_by_login(db, UUID(SCHOOL_ID), "teacher01")
    assert u is not None and u.display_name == "张老师"
    assert verify_password("dev123", u.password_hash)  # pgcrypto $2a$ 哈希兼容


def test_login_name_is_trimmed(db):
    assert get_user_by_login(db, UUID(SCHOOL_ID), "  teacher01 ") is not None


def test_unknown_login_returns_none(db):
    assert get_user_by_login(db, UUID(SCHOOL_ID), "nobody") is None


def test_get_user(db):
    assert get_user(db, UUID(TEACHER_USER_ID)).login_name == "teacher01"
