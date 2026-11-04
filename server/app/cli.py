import argparse
import asyncio
import sys
import time
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import replace
from datetime import date
from pathlib import Path
from typing import TextIO
from urllib.parse import urlparse
from uuid import UUID

import httpx
from redis import Redis
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.ai.client import AIUpstreamError, ChatMessage, Delta
from app.ai.providers import PRESETS
from app.ai.settings import (
    AIConfig,
    clear_ai_config,
    is_ready,
    key_undecryptable,
    load_ai_config,
    make_client,
    save_ai_config,
)
from app.audit.service import record
from app.clock import utc_now
from app.config import get_settings

SEED_SCHOOL_ID = "11111111-1111-1111-1111-111111111111"
SEED_SQL = Path(__file__).parent / "seed" / "dev_seed.sql"


def seed_dev() -> str:
    engine = create_engine(get_settings().database_url)
    try:
        with engine.begin() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM schools WHERE id = :id"), {"id": SEED_SCHOOL_ID}
            ).first()
            if exists:
                return "already seeded"
            conn.exec_driver_sql(
                SEED_SQL.read_text(encoding="utf-8"), execution_options={"no_parameters": True}
            )
            return "seeded"
    finally:
        engine.dispose()


def _show(cfg: AIConfig | None, *, undecryptable: bool = False) -> None:
    if cfg is None:
        print("尚未配置 AI 服务")
        return
    name = PRESETS[cfg.provider].name if cfg.provider in PRESETS else cfg.provider
    print(f"服务商:{name}({cfg.provider})")
    print(f"地址:{cfg.base_url}")
    print(f"模型:{cfg.model}")
    print(f"temperature:{cfg.temperature}")
    if undecryptable:
        print("API Key:无法解密(主密钥可能已更换),请重新设置")
    else:
        print(f"API Key:已设置(…{cfg.api_key[-4:]})" if cfg.api_key else "API Key:未设置")
    print(f"强制隐去姓名:{'是' if cfg.mask_forced else '否'}")
    preset = PRESETS.get(cfg.provider)
    if preset and preset.hint and (not is_ready(cfg) or not cfg.model):
        print(f"提示:{preset.hint}")


def _usage_error(msg: str) -> int:
    print(msg, file=sys.stderr)
    return 2


def _set(ns: argparse.Namespace, db: Session, key: bytes, school_id) -> int:
    old = load_ai_config(db, school_id, key)
    provider = ns.provider or (old.provider if old else None)
    if provider is None:
        return _usage_error("还没有 AI 配置,请用 --provider 指定服务商")
    if ns.temperature is not None and not 0 <= ns.temperature <= 1.5:
        return _usage_error("temperature 必须在 0 到 1.5 之间")
    if old is None or ns.provider and ns.provider != old.provider:
        preset = PRESETS[provider]
        base = AIConfig(
            provider, preset.base_url, preset.model, 0.7, old.api_key if old else None, False
        )
        if old is not None:
            base = replace(base, temperature=old.temperature, mask_forced=old.mask_forced)
    else:
        base = old
    cfg = replace(
        base,
        base_url=ns.base_url or base.base_url,
        model=ns.model or base.model,
        temperature=base.temperature if ns.temperature is None else ns.temperature,
        mask_forced=base.mask_forced if ns.mask_forced is None else ns.mask_forced,
    )
    dropped = False
    if ns.api_key_stdin:
        cfg = replace(cfg, api_key=ns.stdin_key or None)
    elif old is not None and cfg.api_key:
        host = urlparse(cfg.base_url).hostname
        if provider != old.provider or host != urlparse(old.base_url).hostname:
            cfg = replace(cfg, api_key=None)  # 不把旧 Key 发给新服务商/新地址
            dropped = True
    if provider == "custom" and not (cfg.base_url and cfg.model):
        return _usage_error("自定义服务商必须同时提供 --base-url 和 --model")
    save_ai_config(db, school_id, key, cfg)
    record(
        db,
        user_id=None,
        action="ai.config",
        success=True,
        extra={
            "provider": cfg.provider,
            "model": cfg.model,
            "key_changed": cfg.api_key != (old.api_key if old else None),
            "via": "cli",
        },
    )
    db.commit()
    print("已保存")
    if dropped:
        print("已更换服务商或地址,原 API Key 已清除,请用 --api-key-stdin 重新设置")
    _show(cfg)
    return 0


async def _probe(cfg: AIConfig, transport: httpx.AsyncBaseTransport | None) -> str:
    messages = [
        ChatMessage("system", "只做连通性测试"),
        ChatMessage("user", "请只回复四个字:连接成功"),
    ]
    parts: list[str] = []
    async for ev in make_client(cfg, transport).stream(messages, max_tokens=20):
        if isinstance(ev, Delta):
            parts.append(ev.text)
    return "".join(parts)


def ai_config(
    ns: argparse.Namespace,
    *,
    db_factory: Callable[[], AbstractContextManager[Session]],
    stdin: TextIO,
    transport: httpx.AsyncBaseTransport | None = None,
) -> int:
    settings = get_settings()
    school_id, key = settings.school_id, settings.master_key_bytes
    if ns.action == "set" and ns.api_key_stdin:
        ns.stdin_key = stdin.readline().strip()
    with db_factory() as db:
        if ns.action == "set":
            return _set(ns, db, key, school_id)
        if ns.action == "show":
            _show(
                load_ai_config(db, school_id, key),
                undecryptable=key_undecryptable(db, school_id, key),
            )
            return 0
        if ns.action == "clear":
            clear_ai_config(db, school_id)
            record(
                db,
                user_id=None,
                action="ai.config",
                success=True,
                extra={"cleared": True, "via": "cli"},
            )
            db.commit()
            print("已清除")
            return 0
        cfg = load_ai_config(db, school_id, key)
    # test
    if cfg is None or not is_ready(cfg):
        print("尚未配置 AI 服务或配置不完整")
        return 1
    start = time.perf_counter()
    try:
        reply = asyncio.run(_probe(cfg, transport))
    except AIUpstreamError as e:
        print(f"连接失败:{e.message}")
        return 1
    print(f"连接成功,用时 {time.perf_counter() - start:.1f} 秒,回复:{reply[:40]}")
    return 0


def parent_archive(
    ns: argparse.Namespace,
    *,
    db_factory: Callable[[], AbstractContextManager[Session]],
    redis: Redis | None,
    out: TextIO,
) -> int:
    from app.domain.parents.lifecycle import archive_expired

    with db_factory() as db:
        res = archive_expired(db, get_settings().school_id, utc_now(), redis, dry_run=ns.dry_run)
        if ns.dry_run:
            db.rollback()
    print(f"已归档绑定 {res.links} 条,账号 {res.users} 个", file=out)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed-dev", help="insert the dev seed data if absent")
    ai = sub.add_parser("ai-config", help="查看或设置 AI 服务")
    actions = ai.add_subparsers(dest="action", required=True)
    actions.add_parser("show", help="显示当前配置")
    actions.add_parser("test", help="测试连通性")
    actions.add_parser("clear", help="清除配置")
    s = actions.add_parser("set", help="设置配置(与现有配置合并)")
    s.add_argument("--provider", choices=list(PRESETS))
    s.add_argument("--base-url")
    s.add_argument("--model")
    s.add_argument("--temperature", type=float)
    s.add_argument("--api-key-stdin", action="store_true", help="从标准输入读取 API Key")
    mask = s.add_mutually_exclusive_group()
    mask.add_argument("--mask-forced", dest="mask_forced", action="store_true", default=None)
    mask.add_argument("--no-mask-forced", dest="mask_forced", action="store_false")
    pa = sub.add_parser("parent-archive", help="归档只读满一年的家长绑定与账号")
    pa.add_argument("--dry-run", action="store_true", help="只统计,不改数据")
    yu = sub.add_parser("year-upgrade", help="学年升级:生成方案、预览、执行、回滚")
    ya = yu.add_subparsers(dest="action", required=True)
    ys = ya.add_parser("suggest", help="按现有班级生成升级方案 JSON")
    ys.add_argument("--name", required=True, help="新学年名,如 2027-2028")
    ys.add_argument("--start", required=True, type=date.fromisoformat, help="开学日 YYYY-MM-DD")
    ys.add_argument("--end", required=True, type=date.fromisoformat, help="学年结束日 YYYY-MM-DD")
    ys.add_argument("--out", help="写入文件;不给则输出到标准输出")
    ya.add_parser("preview", help="预览方案").add_argument("plan")
    yp = ya.add_parser("apply", help="执行方案")
    yp.add_argument("plan")
    yp.add_argument("--yes", action="store_true", help="确认执行")
    yr = ya.add_parser("rollback", help="回滚最近一次升级")
    yr.add_argument("--yes", action="store_true", help="确认回滚")
    yr.add_argument("--upgrade-id", type=UUID, help="要回滚的升级 id;不是最近一次则拒绝")
    return parser


def main() -> None:
    ns = build_parser().parse_args()
    if ns.command == "seed-dev":
        print(seed_dev())
    elif ns.command == "ai-config":
        engine = create_engine(get_settings().database_url)
        try:
            code = ai_config(ns, db_factory=sessionmaker(bind=engine), stdin=sys.stdin)
        finally:
            engine.dispose()
        sys.exit(code)
    elif ns.command == "parent-archive":
        engine = create_engine(get_settings().database_url)
        redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
        try:
            code = parent_archive(
                ns, db_factory=sessionmaker(bind=engine), redis=redis, out=sys.stdout
            )
        finally:
            redis.close()
            engine.dispose()
        sys.exit(code)
    elif ns.command == "year-upgrade":
        from app.domain.years import cli as years_cli

        engine = create_engine(get_settings().database_url)
        try:
            code = years_cli.run(ns, sessionmaker(bind=engine), sys.stdout)
        finally:
            engine.dispose()
        sys.exit(code)


if __name__ == "__main__":
    main()
