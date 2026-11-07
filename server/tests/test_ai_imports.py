"""app.ai 包的对外边界:其他模块只能导入它的公开名字,不跨模块拿下划线开头的私有函数(L18)。"""

import ast
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"


def _private_imports_from_app_ai() -> list[str]:
    found = []
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or not node.module:
                continue
            if node.module != "app.ai" and not node.module.startswith("app.ai."):
                continue
            for alias in node.names:
                if alias.name.startswith("_"):
                    rel = path.relative_to(APP.parent)
                    found.append(f"{rel}:{node.lineno} {node.module}.{alias.name}")
    return found


def test_no_private_names_imported_from_app_ai():
    assert _private_imports_from_app_ai() == []


def _private_imports_from_audit_service() -> list[str]:
    """跨模块从 app.audit.service 导入下划线名字的位置(L245)。"""
    found = []
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or node.module != "app.audit.service":
                continue
            for alias in node.names:
                if alias.name.startswith("_"):
                    rel = path.relative_to(APP.parent)
                    found.append(f"{rel}:{node.lineno} {node.module}.{alias.name}")
    return found


def test_no_private_imports_across_modules():
    """L245:audit/service 的 client_ip 只有公开名;旧别名(下划线开头的同名)全仓不再出现,
    连字面量也不留(名字拼出来,免得这条测试自己成为 rg 的命中)。"""
    assert _private_imports_from_audit_service() == []
    legacy = "_" + "client_ip"
    hits = [
        str(p.relative_to(APP.parent))
        for p in sorted(APP.rglob("*.py"))
        if legacy in p.read_text(encoding="utf-8")
    ]
    assert hits == []
