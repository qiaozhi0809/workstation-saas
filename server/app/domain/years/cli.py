"""`year-upgrade` 命令:suggest / preview / apply / rollback。"""

import argparse
import json
from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import TextIO

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.clock import utc_now
from app.config import get_settings
from app.domain.years import service
from app.domain.years.plan import UpgradePlan
from app.domain.years.service import UpgradeError, UpgradePreview
from app.domain.years.suggest import suggest

CONFIRM_HINT = "确认无误后加 --yes 执行"


# UPGRADE_HAS_DATA 的 details 键(表名)→ 给管理员看的说法
_DATA_LABELS = {
    "attendances": "考勤记录 {} 条",
    "attendance_days": "已确认的考勤 {} 天",
    "reviews": "点评 {} 条",
    "exams": "考试 {} 场",
    "seat_arrangements": "排座方案 {} 个",
    "growth_records": "成长记录 {} 条",
    "comments": "评语 {} 条",
    "ai_chats": "AI 对话 {} 个",
    "new_students": "新增学生 {} 人",
    "grade_exams": "年级联考 {} 场",
    "class_boards": "看板改动 {} 处",
    "seats": "座位调整 {} 个班",
    "class_roles": "班干部变动 {} 人",
    "transfers": "学生转出 {} 人",
    "class_changes": "学生换班 {} 人",
    "new_grades": "手动新建的年级 {} 个",
    "new_classes": "手动新建的班级 {} 个",
    "new_assignments": "手动添加的任职 {} 条",
    "new_bindings": "手动添加的管理岗任命 {} 条",
}


def _print_error(e: UpgradeError, out: TextIO) -> int:
    print(f"失败:{e.message}", file=out)
    details = e.details or {}
    if e.code == service.HAS_DATA:
        for k, v in details.items():
            label = _DATA_LABELS.get(k)
            print(f"  {label.format(v)}" if label else f"  {k}: {v}", file=out)
        print("新学年已有数据,不能回滚", file=out)
        return 1
    for k, v in details.items():
        print(f"  {k}: {v}", file=out)
    return 1


def _print_preview(pv: UpgradePreview, out: TextIO) -> None:
    print(f"新学年:{pv.new_year}", file=out)
    new_labels = iter(pv.new_classes)
    for c in pv.classes:
        extras = []
        if c.action == "new":
            line = f"新建:{next(new_labels)}"
        else:
            teacher = f"(班主任 {c.teacher_name or '未定'})" if c.action == "promote" else ""
            head = f"{c.from_name} → {c.to_label}{teacher}"
            if c.action == "promote":
                extras.append(f"随班 {c.follow}")
            else:
                extras.append(f"毕业 {c.graduate}")
            if c.leave:
                extras.append(f"转出 {c.leave}")
            if c.repeat_out:
                extras.append(f"留级 {c.repeat_out}")
            line = f"{head}:{'、'.join(extras)}"
            extras = []
        if c.repeat_in:
            extras.append(f"留级转入 {c.repeat_in}")
        if extras:
            line += (":" if c.action == "new" else "、") + "、".join(extras)
        print(line, file=out)
    for w in pv.warnings:
        print(f"警告:{w}", file=out)


def _load_plan(path: str) -> UpgradePlan:
    try:
        with open(path, encoding="utf-8") as f:
            return UpgradePlan.model_validate_json(f.read())
    except OSError as e:
        raise UpgradeError("UPGRADE_PLAN_FILE", f"无法读取方案文件 {path}:{e.strerror}") from e
    except ValidationError as e:
        errs = [f"{'.'.join(str(p) for p in x['loc'])}: {x['msg']}" for x in e.errors()[:5]]
        raise UpgradeError(
            "UPGRADE_PLAN_FILE", f"方案文件格式不对({path})", {"errors": "; ".join(errs)}
        ) from e


def run(
    ns: argparse.Namespace,
    db_factory: Callable[[], AbstractContextManager[Session]],
    out: TextIO,
) -> int:
    school_id = get_settings().school_id
    try:
        with db_factory() as db:
            return _dispatch(ns, db, school_id, out)
    except UpgradeError as e:
        return _print_error(e, out)
    except SQLAlchemyError as e:
        print(f"失败:数据库操作失败({type(e).__name__})", file=out)
        return 1


def _dispatch(ns: argparse.Namespace, db: Session, school_id, out: TextIO) -> int:
    if ns.action == "suggest":
        plan = suggest(db, school_id, ns.name, ns.start, ns.end)
        data = json.dumps(plan.model_dump(mode="json"), ensure_ascii=False, indent=2)
        if ns.out:
            with open(ns.out, "w", encoding="utf-8") as f:
                f.write(data + "\n")
            print(f"方案已写入 {ns.out}", file=out)
        else:
            print(data, file=out)
        return 0
    if ns.action in ("preview", "apply"):
        plan = _load_plan(ns.plan)
        _print_preview(service.preview(db, school_id, plan), out)
        if ns.action == "preview":
            return 0
        if not ns.yes:
            print(CONFIRM_HINT, file=out)
            return 0
        up = service.apply(db, school_id, plan, now=utc_now())
        c = up.summary["counts"]
        print(
            f"已完成:新建 {c['classes']} 个班,随班 {c['promoted']} 人,留级 {c['repeated']} 人,"
            f"毕业 {c['graduated']} 人,转出 {c['left']} 人",
            file=out,
        )
        return 0
    # rollback
    if not ns.yes:
        up = service.latest_rollbackable(db, school_id)
        if ns.upgrade_id is not None and ns.upgrade_id != up.id:
            raise UpgradeError(
                service.NOT_LATEST,
                "只能回滚最近一次学年升级,请刷新后重试",
                {"latest_id": str(up.id)},
            )
        print(
            f"将回滚学年升级:{up.plan['new_year']['name']}(执行于 {up.executed_at:%Y-%m-%d %H:%M})",
            file=out,
        )
        print(CONFIRM_HINT, file=out)
        return 0
    service.rollback(db, school_id, now=utc_now(), upgrade_id=ns.upgrade_id)
    print("已完成:学年升级已回滚", file=out)
    return 0
