"""迁移预检:升级前找出会让迁移中途失败的旧数据,并给出定位 SQL 与处理建议(L3、L31)。

只检查"对已有表新加的约束"(命名 CHECK / UNIQUE、唯一索引、SET NOT NULL);
迁移自己新建的表、升级前并不存在,无从预检。逐条以 migrations/versions/*.up.sql 的实际 SQL 为准。
"""

from dataclasses import dataclass
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, text

SERVER_DIR = Path(__file__).resolve().parents[2]


class UnknownVersionError(Exception):
    """alembic_version 里是本程序不认识的版本(数据库比程序新,或来自别的分支)。"""

    def __init__(self, version: str):
        super().__init__(version)
        self.version = version


@dataclass(frozen=True)
class Check:
    revision: str
    name: str  # 报告里的短标签,如 "classes 座位行列数"
    count_sql: str  # 返回违规行数(或违规分组数)
    locate_sql: str  # 可直接在 psql 里运行的 SELECT,列出违规行
    advice: str
    problem: str = "{n} 行不满足新约束"  # 报告里 name 后面的说明,{n} 为 count_sql 的结果
    tables: tuple[str, ...] = ()  # 这些表都存在时才检查(表由待执行迁移创建则跳过)
    constraints: tuple[str, ...] = ()  # 本条覆盖的约束标识,供完整性测试对照迁移 SQL


@dataclass(frozen=True)
class SizeNotice:
    revision: str
    table: str
    threshold_rows: int
    message: str


@dataclass
class PrecheckReport:
    failures: list[tuple[Check, int]]
    notices: list[tuple[SizeNotice, int]]

    @property
    def ok(self) -> bool:
        return not self.failures


# ---------------------------------------------------------------------------
# 登记表。"新加列 + DEFAULT / 迁移自身先修数据"必然满足约束的不登,理由见 EXEMPT_CONSTRAINTS;
# 完整性由 tests/test_precheck.py::test_every_constraint_in_migrations_has_check 保证:
# 迁移里每条对已有表加的约束,要么在这里登记,要么在 EXEMPT_CONSTRAINTS 写明理由。
# ---------------------------------------------------------------------------
CHECKS: tuple[Check, ...] = (
    Check(
        revision="0002",
        name="classes 座位行列数",
        count_sql=(
            "SELECT count(*) FROM classes"
            " WHERE NOT (seat_rows BETWEEN 1 AND 12 AND seat_cols BETWEEN 1 AND 12)"
        ),
        locate_sql=(
            "SELECT id, name, seat_rows, seat_cols FROM classes"
            " WHERE NOT (seat_rows BETWEEN 1 AND 12 AND seat_cols BETWEEN 1 AND 12);"
        ),
        advice=(
            "把这些班级的座位行数、列数改到 1–12 之间(班级设置里改,或直接 UPDATE classes),"
            "再重新升级。"
        ),
        problem="{n} 行不在 1–12 之间",
        tables=("classes",),
        constraints=("classes_seat_dims",),
    ),
    Check(
        revision="0002",
        name="enrollments 座位行列成对",
        count_sql=(
            "SELECT count(*) FROM enrollments WHERE NOT ((seat_row IS NULL) = (seat_col IS NULL))"
        ),
        locate_sql=(
            "SELECT id, student_id, class_id, seat_row, seat_col FROM enrollments"
            " WHERE NOT ((seat_row IS NULL) = (seat_col IS NULL));"
        ),
        advice=(
            "座位的行和列必须同时有值或同时为空:补全,"
            "或把这些学生的 seat_row、seat_col 都置为 NULL。"
        ),
        problem="{n} 行只填了行或只填了列",
        tables=("enrollments",),
        constraints=("enrollments_seat_pair",),
    ),
    Check(
        revision="0002",
        name="enrollments 同座唯一",
        count_sql=(
            "SELECT count(*) FROM (SELECT 1 FROM enrollments"
            " WHERE status = 'active' AND seat_row IS NOT NULL AND seat_col IS NOT NULL"
            " GROUP BY class_id, seat_row, seat_col HAVING count(*) > 1) t"
        ),
        locate_sql=(
            "SELECT class_id, seat_row, seat_col, count(*) AS n, array_agg(id) AS enrollment_ids"
            " FROM enrollments"
            " WHERE status = 'active' AND seat_row IS NOT NULL AND seat_col IS NOT NULL"
            " GROUP BY class_id, seat_row, seat_col HAVING count(*) > 1;"
        ),
        advice=(
            "同一班级同一座位上坐了不止一名在读学生:给多出来的学生换座位,"
            "或把其 seat_row、seat_col 置为 NULL。"
        ),
        problem="{n} 个座位坐了多名在读学生",
        tables=("enrollments",),
        constraints=("enrollments_one_per_seat",),
    ),
    # 0003 / 0004 先 DROP 再 ADD enrollments_status_check:只是放宽取值集合,
    # 0001 的约束已保证旧数据落在新集合内;仍登记,防止有人手工改过约束后留下异常状态值。
    Check(
        revision="0003",
        name="enrollments 状态取值",
        count_sql=(
            "SELECT count(*) FROM enrollments"
            " WHERE NOT (status IN ('active','graduated','transferred','removed'))"
        ),
        locate_sql=(
            "SELECT id, student_id, class_id, status FROM enrollments"
            " WHERE NOT (status IN ('active','graduated','transferred','removed'));"
        ),
        advice="把这些在读记录的 status 改成 active / graduated / transferred / removed 之一。",
        problem="{n} 行状态值不在允许范围内",
        tables=("enrollments",),
        constraints=("enrollments_status_check",),
    ),
    Check(
        revision="0004",
        name="enrollments 状态取值",
        count_sql=(
            "SELECT count(*) FROM enrollments"
            " WHERE NOT (status IN ('active','graduated','transferred','removed','promoted'))"
        ),
        locate_sql=(
            "SELECT id, student_id, class_id, status FROM enrollments"
            " WHERE NOT (status IN ('active','graduated','transferred','removed','promoted'));"
        ),
        advice=(
            "把这些在读记录的 status 改成 active / graduated / transferred / removed / "
            "promoted 之一。"
        ),
        problem="{n} 行状态值不在允许范围内",
        tables=("enrollments",),
        constraints=("enrollments_status_check",),
    ),
    Check(
        revision="0005",
        name="enrollments 座位编码",
        count_sql=(
            "SELECT count(*) FROM enrollments WHERE NOT (seat_row IS NULL OR seat_row >= 1"
            " OR (seat_row = 0 AND seat_col IN (-2,-1,1,2)))"
        ),
        locate_sql=(
            "SELECT id, student_id, class_id, seat_row, seat_col FROM enrollments"
            " WHERE NOT (seat_row IS NULL OR seat_row >= 1"
            " OR (seat_row = 0 AND seat_col IN (-2,-1,1,2)));"
        ),
        advice=(
            "座位行必须为空或 >= 1;第 0 排只允许讲台边座位(列 -2、-1、1、2)。"
            "把这些记录的 seat_row、seat_col 置为 NULL 或改成合法座位。"
        ),
        problem="{n} 行座位编码不合法",
        tables=("enrollments",),
        constraints=("enrollments_seat_code",),
    ),
    Check(
        revision="0007",
        name="users 登录名大小写重复",
        count_sql=(
            "SELECT count(*) FROM (SELECT 1 FROM users"
            " GROUP BY school_id, lower(login_name) HAVING count(*) > 1) t"
        ),
        locate_sql=(
            "SELECT school_id, lower(login_name) AS login_lower, count(*) AS n,"
            " array_agg(login_name) AS login_names, array_agg(id) AS user_ids"
            " FROM users GROUP BY school_id, lower(login_name) HAVING count(*) > 1;"
        ),
        advice=(
            "同一学校内登录名忽略大小写后重复(如 Teacher01 与 teacher01):"
            "给其中一个改名(账号管理里改登录名),直到忽略大小写后不再重复。"
        ),
        problem="{n} 组登录名忽略大小写后重复",
        tables=("users",),
        constraints=("users_school_login_lower_key",),
    ),
    Check(
        revision="0008",
        name="teacher_assignments 班主任唯一",
        count_sql=(
            "SELECT count(*) FROM (SELECT 1 FROM teacher_assignments"
            " WHERE identity = 'homeroom' AND ended_at IS NULL"
            " GROUP BY class_id HAVING count(*) > 1) t"
        ),
        locate_sql=(
            "SELECT class_id, count(*) AS n, array_agg(id) AS assignment_ids"
            " FROM teacher_assignments"
            " WHERE identity = 'homeroom' AND ended_at IS NULL"
            " GROUP BY class_id HAVING count(*) > 1;"
        ),
        advice=(
            "有班级同时存在多条未结束的班主任任职:只保留一条,"
            "其余设置 ended_at(在班级任课设置里撤销多余的班主任)。"
        ),
        problem="{n} 个班级有多名在任班主任",
        tables=("teacher_assignments",),
        constraints=("teacher_assignments_one_homeroom",),
    ),
    # 0010 notices_require_ack_ck:require_ack = (ack_kind <> 'none');
    # 旧通知的 ack_kind 取默认值 'none',所以旧通知里 require_ack = true 的行会让迁移中途失败。
    Check(
        revision="0010",
        name="notices 需回执标记",
        count_sql="SELECT count(*) FROM notices WHERE require_ack",
        locate_sql="SELECT id, title, created_at FROM notices WHERE require_ack;",
        advice=(
            '旧通知里有标了"需要回执"的行,而旧通知没有结构化回执类型,升级会失败。'
            "确认这些通知已不需要回执后,执行 "
            "UPDATE notices SET require_ack = false WHERE require_ack; 再升级。"
        ),
        problem="{n} 行标了需要回执",
        tables=("notices",),
        constraints=("notices_require_ack_ck",),
    ),
    Check(
        revision="0010",
        name="notice_recipients 留言长度",
        count_sql="SELECT count(*) FROM notice_recipients WHERE char_length(ack_content) > 200",
        locate_sql=(
            "SELECT notice_id, user_id, char_length(ack_content) AS len FROM notice_recipients"
            " WHERE char_length(ack_content) > 200;"
        ),
        advice=(
            "回执留言上限 200 字:把这些留言截短到 200 字以内,"
            "例如 UPDATE notice_recipients SET ack_content = left(ack_content, 200)"
            " WHERE char_length(ack_content) > 200;"
        ),
        problem="{n} 行回执留言超过 200 字",
        tables=("notice_recipients",),
        constraints=("notice_recipients_ack_content_ck",),
    ),
    # 0014 uq_classes_grade_name:同一年级里班名唯一。按行报(每个与同年级其他班重名的班一行),
    # 与 locate_sql 的行数一致。
    Check(
        revision="0014",
        name="classes 同年级重名",
        count_sql=(
            "SELECT count(*) FROM classes c WHERE EXISTS (SELECT 1 FROM classes d"
            " WHERE d.grade_id = c.grade_id AND d.name = c.name AND d.id <> c.id)"
        ),
        locate_sql=(
            "SELECT c.id, c.name, c.grade_id FROM classes c WHERE EXISTS (SELECT 1 FROM classes d"
            " WHERE d.grade_id = c.grade_id AND d.name = c.name AND d.id <> c.id)"
            " ORDER BY c.grade_id, c.name, c.id;"
        ),
        advice="把同一年级里重名的班级改名后再升级(组织架构里改班级名,或直接 UPDATE classes)。",
        problem="{n} 个班级与同年级其他班重名",
        tables=("classes",),
        constraints=("uq_classes_grade_name",),
    ),
)

# 对已有表加了约束、但不需要预检的:(revision, 约束标识) -> 理由。标识为约束名 / 索引名,
# SET NOT NULL 写成 "表.列"。
EXEMPT_CONSTRAINTS: dict[tuple[str, str], str] = {
    ("0002", "enrollments_lock_needs_seat"): (
        "约束加在本迁移新增列 seat_locked 上,DEFAULT false 对所有旧行都满足"
    ),
    (
        "0004",
        "students.mask_no",
    ): "mask_no 是本迁移新增列,迁移自身先按 (created_at, mk) 回填再 SET NOT NULL",
    ("0004", "students_school_mask_no_key"): "mask_no 由迁移自身全校连续回填,必然唯一",
    ("0005", "classes_desk_cols"): (
        "desk_size 是本迁移新增列(默认 2);迁移先把奇数 seat_cols 加 1 变成偶数,再加约束,必然满足"
    ),
    ("0006", "comments_one_per_content"): (
        "迁移自身先删除同一学生同学期内容完全相同的重复评语(保留最早一条),再建唯一索引,必然满足"
    ),
    ("0008", "exams_one_per_grade_exam"): (
        "索引建在本迁移新增列 grade_exam_id 上且带 WHERE grade_exam_id IS NOT NULL,旧行全为 NULL"
    ),
    ("0009", "parent_links_readonly_since_ck"): (
        "约束涉及本迁移新增列 status(默认 active)与 readonly_since(NULL),旧行必然满足"
    ),
    ("0009", "parent_links_ended_at_ck"): (
        "约束涉及本迁移新增列 status(默认 active)与 ended_at(NULL),旧行必然满足"
    ),
    ("0009", "parent_links_one_primary"): (
        "重建的唯一索引比旧索引(WHERE is_primary)更宽松,满足旧索引的旧数据必然满足新索引"
    ),
    ("0010", "notices_students_without_parent_ck"): (
        "约束加在本迁移新增列 students_without_parent 上,DEFAULT 0 必然满足"
    ),
    ("0010", "notices_ack_options_ck"): (
        "涉及本迁移新增列 ack_kind(默认 none)与 ack_options(NULL),旧行必然满足"
    ),
    ("0011", "users_totp_pair_ck"): ("两列均为本迁移新增的可空列,旧行全为 NULL,必然满足"),
}

# 人工签收(L113)。tests/test_precheck.py 的扫描器只认已有表上的命名 CHECK / UNIQUE、唯一索引、
# SET NOT NULL;ALTER TYPE、DO 块、ADD COLUMN NOT NULL DEFAULT、FK 列回填都在它的盲区里。
# 所以每个 revision 的 up.sql 都要有人逐项核对过这些盲区,再把编号签到这里;
# 新迁移不签收,tests/test_precheck.py::test_every_revision_is_reviewed 就红。
# 0013 签收备注:
#   - notice_students ADD class_id(可空,FK → classes ON DELETE SET NULL)、class_name(可空);
#     回填 DISTINCT ON (student_id) 只 JOIN 仍存在的班,没有注册的学生留 NULL,不 SET NOT NULL;
#   - user_preferences ADD onboarded jsonb NOT NULL DEFAULT '{}'::jsonb:常量默认值,PG16 不重写表;
#   - users ADD token_floor_at timestamptz 可空;
#   - 无 CHECK、无唯一约束、无 ALTER TYPE、无 DO 块。
# 0014 签收备注:
#   - CREATE INDEX ix_notice_students_class_id ON notice_students (class_id):普通索引,无约束;
#   - CREATE UNIQUE INDEX uq_classes_grade_name ON classes (grade_id, name):已登记 CHECKS
#     "classes 同年级重名"(扫描器自己也认得出);
#   - 不加列、不改类型、无 ALTER TYPE、无 DO 块。
REVIEWED_REVISIONS: frozenset[str] = frozenset(
    {
        "0001",
        "0002",
        "0003",
        "0004",
        "0005",
        "0006",
        "0007",
        "0008",
        "0009",
        "0010",
        "0011",
        "0012",
        "0013",
        "0014",
    }
)

SIZE_NOTICES: tuple[SizeNotice, ...] = (
    SizeNotice(
        revision="0008",
        table="audit_logs",
        threshold_rows=1_000_000,
        message="建索引期间会阻塞审计写入,预计数分钟;请在课后升级",
    ),
)


def alembic_config(engine: Engine) -> Config:
    cfg = Config(str(SERVER_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(SERVER_DIR / "migrations"))
    url = engine.url.render_as_string(hide_password=False)
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return cfg


def head_revision(engine: Engine) -> str:
    return ScriptDirectory.from_config(alembic_config(engine)).get_current_head() or ""


def _table_exists(conn, table: str) -> bool:
    return conn.execute(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": table}).scalar_one()


def pending_revisions(engine: Engine) -> list[str]:
    """待执行的 revision(由旧到新);空库返回全部。"""
    script = ScriptDirectory.from_config(alembic_config(engine))
    ordered = [r.revision for r in reversed(list(script.walk_revisions()))]
    with engine.connect() as conn:
        current = None
        if _table_exists(conn, "alembic_version"):
            current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    if current is None:
        return ordered
    if current not in ordered:
        raise UnknownVersionError(current)
    return ordered[ordered.index(current) + 1 :]


def run_precheck(engine: Engine, pending: list[str]) -> PrecheckReport:
    failures: list[tuple[Check, int]] = []
    notices: list[tuple[SizeNotice, int]] = []
    with engine.connect() as conn:
        for check in CHECKS:
            if check.revision not in pending:
                continue
            if not all(_table_exists(conn, t) for t in check.tables):
                continue
            n = conn.execute(text(check.count_sql)).scalar_one()
            if n > 0:
                failures.append((check, n))
        for notice in SIZE_NOTICES:
            if notice.revision not in pending or not _table_exists(conn, notice.table):
                continue
            n = conn.execute(text(f"SELECT count(*) FROM {notice.table}")).scalar_one()
            if n >= notice.threshold_rows:
                notices.append((notice, n))
        conn.rollback()
    return PrecheckReport(failures=failures, notices=notices)


def render(report: PrecheckReport, pending: list[str]) -> str:
    lines = [f"迁移预检:待执行 {'、'.join(pending)}" if pending else "迁移预检:没有待执行的迁移"]
    for check, n in report.failures:
        lines.append(f"[不通过] {check.revision} {check.name}:{check.problem.format(n=n)}")
        lines.append(f"  定位:{check.locate_sql}")
        lines.append(f"  处理建议:{check.advice}")
    for notice, n in report.notices:
        lines.append(f"[提示] {notice.revision} {notice.table} 有 {n:,} 行,{notice.message}")
    if report.ok:
        lines.append("预检结果:通过。")
    else:
        lines.append(f"预检结果:不通过({len(report.failures)} 项)。未做任何改动。")
    return "\n".join(lines) + "\n"
