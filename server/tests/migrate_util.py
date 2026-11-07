"""迁移相关测试的小工具:升级到指定 revision、读当前版本(L114:原先放在 test_precheck.py)。"""

from alembic import command
from sqlalchemy import Engine, text

from app.deploy.precheck import alembic_config


def upgrade_to(engine: Engine, revision: str) -> None:
    command.upgrade(alembic_config(engine), revision)


def current_version(engine: Engine) -> str | None:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT version_num FROM alembic_version")).first()
    return row[0] if row else None
