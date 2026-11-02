from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

from app.config import Settings
from app.db import get_db
from app.main import create_app
from app.redis import get_redis

SERVER_DIR = Path(__file__).resolve().parent.parent
# HS256 建议密钥至少 32 字节;开发默认密钥较短,每次签发都会报 InsecureKeyLengthWarning
TEST_JWT_SECRET = "test-jwt-secret-for-pytest-only-0123456789"


@pytest.fixture(scope="session")
def pg_url() -> Iterator[str]:
    with PostgresContainer("postgres:16-alpine", driver="psycopg") as pg:
        url = pg.get_connection_url()
        cfg = Config(str(SERVER_DIR / "alembic.ini"))
        cfg.set_main_option("script_location", str(SERVER_DIR / "migrations"))
        cfg.set_main_option("sqlalchemy.url", url)
        command.upgrade(cfg, "head")
        seed_sql = (SERVER_DIR / "app" / "seed" / "dev_seed.sql").read_text(encoding="utf-8")
        seed_engine = create_engine(url)
        with seed_engine.begin() as conn:
            conn.exec_driver_sql(seed_sql, execution_options={"no_parameters": True})
        seed_engine.dispose()
        yield url


@pytest.fixture(scope="session")
def engine(pg_url: str) -> Iterator[Engine]:
    eng = create_engine(pg_url)
    yield eng
    eng.dispose()


@pytest.fixture(scope="session")
def redis_url() -> Iterator[str]:
    with RedisContainer("redis:7-alpine") as rc:
        yield f"redis://{rc.get_container_host_ip()}:{rc.get_exposed_port(6379)}/0"


@pytest.fixture
def redis_client(redis_url: str) -> Iterator[Redis]:
    client = Redis.from_url(redis_url, decode_responses=True)
    client.flushdb()
    yield client
    client.close()


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    """每个测试一个外层事务;代码里的 commit 只提交到 savepoint,测试结束整体回滚。"""
    with engine.connect() as conn:
        trans = conn.begin()
        session = Session(bind=conn, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            session.close()
            trans.rollback()


@pytest.fixture
def settings(pg_url: str, redis_url: str) -> Settings:
    return Settings(
        _env_file=None, database_url=pg_url, redis_url=redis_url, jwt_secret=TEST_JWT_SECRET
    )


@pytest.fixture
def client(settings: Settings, db: Session, redis_client: Redis) -> TestClient:
    app = create_app(settings)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_redis] = lambda: redis_client
    return TestClient(app)
