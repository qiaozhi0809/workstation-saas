"""并发测试用的一次性数据库:每个测试模块自己起一个容器,不碰会话级共享测试库。

用法(各测试文件自己包一层 module 级 fixture):

    @pytest.fixture(scope="module")
    def cengine() -> Iterator[Engine]:
        with make_concurrent_engine() as eng:
            yield eng
"""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine
from testcontainers.community.postgres import PostgresContainer

SERVER_DIR = Path(__file__).resolve().parent.parent


@contextmanager
def make_concurrent_engine() -> Iterator[Engine]:
    """起一个 Postgres 容器,迁移到 head 并灌开发种子,产出 Engine(连接池够多个线程用)。"""
    with PostgresContainer("postgres:16-alpine", driver="psycopg") as pg:
        url = pg.get_connection_url()
        cfg = Config(str(SERVER_DIR / "alembic.ini"))
        cfg.set_main_option("script_location", str(SERVER_DIR / "migrations"))
        cfg.set_main_option("sqlalchemy.url", url)
        command.upgrade(cfg, "head")
        seed_sql = (SERVER_DIR / "app" / "seed" / "dev_seed.sql").read_text(encoding="utf-8")
        engine = create_engine(url, pool_size=8, max_overflow=8)
        try:
            with engine.begin() as conn:
                conn.exec_driver_sql(seed_sql, execution_options={"no_parameters": True})
            yield engine
        finally:
            engine.dispose()
