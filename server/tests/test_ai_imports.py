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
