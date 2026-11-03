"""`year-upgrade` 命令:suggest / preview / apply / rollback。"""

import argparse
import json
from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import TextIO

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.clock import utc_now
from app.config import get_settings
from app.domain.years import service
from app.domain.years.plan import UpgradePlan
from app.domain.years.service import UpgradeError, UpgradePreview
from app.domain.years.suggest import suggest

CONFIRM_HINT = "确认无误后加 --yes 执行"


def _print_error(e: UpgradeError, out: TextIO) -> int:
    print(f"失败:{e.message}", file=out)
    for k, v in (e.details or {}).items():
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
        print(
            f"将回滚学年升级:{up.plan['new_year']['name']}(执行于 {up.executed_at:%Y-%m-%d %H:%M})",
            file=out,
        )
        print(CONFIRM_HINT, file=out)
        return 0
    service.rollback(db, school_id, now=utc_now())
    print("已完成:学年升级已回滚", file=out)
    return 0
