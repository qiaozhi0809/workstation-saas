import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

# Settings.env 默认已改为 prod(L167 失败即关):测试套件自己声明 dev 环境,
# 让经 get_settings() 的测试(create_app() 无参、years_cli.run、scheduler、parent_archive 等)
# 和本地没有 server/.env 时的 `uv run pytest` 都能跑。必须放在任何 `from app…` 导入之前
# (get_settings 是 lru_cache,Settings() 读环境变量)。测"默认 prod"的用例自己 delenv。
os.environ.setdefault("WS_ENV", "dev")

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

from app.config import Settings, get_settings
from app.db import SessionScope, get_db, session_scope
from app.main import create_app
from app.redis import get_redis
from tests.migrate_util import upgrade_to

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
        _env_file=None,
        env="dev",
        database_url=pg_url,
        redis_url=redis_url,
        jwt_secret=TEST_JWT_SECRET,
    )


def _reuse(db: Session) -> SessionScope:
    """测试里的 session_scope:每次进入都给同一个测试会话,退出不关闭。"""

    @contextmanager
    def scope() -> Iterator[Session]:
        yield db

    return scope


@pytest.fixture
def client(settings: Settings, db: Session, redis_client: Redis) -> TestClient:
    app = create_app(settings)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_redis] = lambda: redis_client
    app.dependency_overrides[session_scope] = lambda: _reuse(db)
    app.state.ai_transport = None
    return TestClient(app)


@pytest.fixture
def dev_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """显式声明 dev 环境:经 get_settings() 的测试(create_app() 无参、CLI、调度任务)用它,
    不再隐式依赖本文件顶部的 setdefault(L205)。get_settings 是 lru_cache,前后各清一次。"""
    monkeypatch.setenv("WS_ENV", "dev")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(scope="module")
def pg_admin_url() -> Iterator[str]:
    """一个空 Postgres 容器的连接串(模块级),供迁移 / 预检类测试在里面反复建空库(L114)。"""
    with PostgresContainer("postgres:16-alpine", driver="psycopg") as pg:
        yield pg.get_connection_url()


def _create_database(pg_admin_url: str) -> tuple[Engine, str]:
    name = f"t_{uuid.uuid4().hex[:12]}"
    admin = create_engine(pg_admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()
    return create_engine(make_url(pg_admin_url).set(database=name)), name


def _drop_database(pg_admin_url: str, eng: Engine, name: str) -> None:
    eng.dispose()
    admin = create_engine(pg_admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
    admin.dispose()


@pytest.fixture
def fresh_engine(pg_admin_url: str) -> Iterator[Engine]:
    """每个测试一个全新的空库(同一个容器里 CREATE DATABASE)。"""
    eng, name = _create_database(pg_admin_url)
    try:
        yield eng
    finally:
        _drop_database(pg_admin_url, eng, name)


@pytest.fixture(scope="module")
def head_engine(pg_admin_url: str) -> Iterator[Engine]:
    """一个升到 head 的空库,供"每条 Check 都能查出脏数据"的测试在事务里反复使用。"""
    eng, name = _create_database(pg_admin_url)
    try:
        upgrade_to(eng, "head")
        yield eng
    finally:
        _drop_database(pg_admin_url, eng, name)
