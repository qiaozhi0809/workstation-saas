"""收集一个测试会话里执行的 SQL 语句流,供"查询条数 / 锁语句先后"类断言共用。"""

from collections.abc import Callable

from sqlalchemy import event
from sqlalchemy.orm import Session


def capture_sql(db: Session) -> tuple[list[str], Callable[[], None]]:
    """返回 (statements, stop):之后在 db 的连接上执行的每条 SQL 都追加到 statements,
    stop() 取消监听。用法:``statements, stop = capture_sql(db); try: … finally: stop()``。"""
    statements: list[str] = []

    def collect(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    conn = db.connection()
    event.listen(conn, "before_cursor_execute", collect)
    return statements, lambda: event.remove(conn, "before_cursor_execute", collect)
