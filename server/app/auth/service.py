from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User


def get_user_by_login(db: Session, school_id: UUID, login_name: str) -> User | None:
    return db.scalar(
        select(User).where(User.school_id == school_id, User.login_name == login_name.strip())
    )


def get_user(db: Session, user_id: UUID) -> User | None:
    return db.get(User, user_id)
