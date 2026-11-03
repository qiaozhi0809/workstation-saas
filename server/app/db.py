from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager

from fastapi import Request
from sqlalchemy.orm import Session, sessionmaker


def get_db(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine) as s:
        yield s


SessionScope = Callable[[], AbstractContextManager[Session]]


def session_scope(request: Request) -> SessionScope:
    """给流式生成器用:每次调用开一个独立会话,用完关闭。"""
    factory = sessionmaker(bind=request.app.state.engine)

    @contextmanager
    def scope() -> Iterator[Session]:
        with factory() as s:
            yield s

    return scope
